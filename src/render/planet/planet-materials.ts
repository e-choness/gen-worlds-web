// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0 or MIT: see LICENSE.md.
/**
 * Terrain and ocean materials. One instance pair per planet; chunks share them and differ only
 * through per-object uniforms (chunk centre and wrapped detail offset).
 *
 * Lighting is evaluated here rather than through three's light system: there is exactly one light
 * (the star), its colour depends on the atmosphere between it and the surface, and the output must
 * stay in scene-linear HDR for the atmosphere pass that follows.
 */

import {
  acos,
  atan,
  attribute,
  cameraPosition,
  clamp,
  dot,
  exp,
  float,
  fract,
  max,
  mix,
  mx_fractal_noise_float,
  mx_noise_float,
  normalize,
  normalLocal,
  positionLocal,
  positionWorld,
  pow,
  sampler,
  smoothstep,
  texture,
  time,
  uniform,
  varying,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import * as THREE from 'three/webgpu';
import type { TerrainTextures, TextureSet } from '@/engine/terrain-textures';
import type { FloatNode, Vec3Node, Vec4Node } from '@/engine/tsl';
import type { AtmosphereModel } from '@/render/atmosphere/atmosphere-model';
import { atmSunAtSurface } from '@/render/atmosphere/atmosphere-wgsl';
import type { BodyDesc, Vec3Tuple } from '@/universe/types';
import type { BiomeTextures } from './biome-texture';
import { ringProfile } from './ring-view';
import type { SurfaceMap } from './surface-maps';

/** Measured colour maps are smoothed between these camera distances, over this many texels. */
const MAP_SMOOTH_FAR_M = 1_500_000;
const MAP_SMOOTH_NEAR_M = 150_000;
const MAP_SMOOTH_TEXELS = 0.9;

const color3 = (c: Vec3Tuple) => new THREE.Vector3(c[0], c[1], c[2]);

/** Uniforms shared by all materials of one planet; updated once per frame by the PlanetRenderer. */
export class PlanetShading {
  /** Unit vector from the planet centre toward the star, planet-local. */
  readonly sunDir = uniform(new THREE.Vector3(1, 0, 0));
  /** Star colour × illuminance at the planet. */
  readonly sunColor = uniform(new THREE.Vector3(1, 1, 1));
  /** Approximate hemispherical sky radiance, for ambient light. */
  readonly skyColor = uniform(new THREE.Vector3(0, 0, 0));
  /** Survey pulse: xyz = origin relative to the camera, w = current radius in metres (< 0 = off). */
  readonly scan = uniform(new THREE.Vector4(0, 0, 0, -1));
  /** Radius at which the pulse has faded out. */
  readonly scanRange = uniform(600);
  /** Spin axis, planet-local (constant per body). */
  readonly axis = uniform(new THREE.Vector3(0, 1, 0));
  /** Headlamp: xyz = position relative to the camera, w = intensity (0 = off). */
  readonly lamp = uniform(new THREE.Vector4(0, 0, 0, 0));
  /** Unit direction the headlamp points along. */
  readonly lampDir = uniform(new THREE.Vector3(0, 0, -1));
  readonly radius: number;

  constructor(
    readonly body: BodyDesc,
    readonly atmosphere: AtmosphereModel | null,
    readonly detailTexture: THREE.Texture,
    readonly textures: TerrainTextures,
    readonly biomes: BiomeTextures,
    /** Measured colour and elevation of a real body, or null for generated worlds. */
    readonly surfaceMap: SurfaceMap | null = null,
  ) {
    this.radius = body.radius;
    this.axis.value.set(...body.axis);
  }
}

/** Per-object uniform: chunk centre in planet-local space (float32 is fine: only used for directions). */
function chunkCenterNode() {
  return uniform(new THREE.Vector3()).onObjectUpdate(
    ({ object }) => object?.userData.chunkCenter as THREE.Vector3,
  );
}

/** Per-object uniform: chunk centre wrapped to the detail period, so detail UVs stay small and seamless. */
function detailOffsetNode() {
  return uniform(new THREE.Vector3()).onObjectUpdate(
    ({ object }) => object?.userData.detailOffset as THREE.Vector3,
  );
}

function triplanarWeights(n: Vec3Node): Vec3Node {
  const w = pow(n.abs(), vec3(6));
  return w.div(w.x.add(w.y).add(w.z));
}

/** Samples the detail texture on the three axis planes. Returns rgba blended by `w`. */
function triplanar(tex: THREE.Texture, p: Vec3Node, w: Vec3Node): Vec4Node {
  const x = texture(tex, p.zy);
  const y = texture(tex, p.xz);
  const z = texture(tex, p.xy);
  return x.mul(w.x).add(y.mul(w.y)).add(z.mul(w.z));
}

/** World-space normal perturbation from a triplanar tangent-normal sample (xy in 0..1). */
function triplanarBump(tex: THREE.Texture, p: Vec3Node, w: Vec3Node): Vec3Node {
  const x = texture(tex, p.zy).xy.mul(2).sub(1);
  const y = texture(tex, p.xz).xy.mul(2).sub(1);
  const z = texture(tex, p.xy).xy.mul(2).sub(1);
  return vec3(0, x.y, x.x)
    .mul(w.x)
    .add(vec3(y.x, 0, y.y).mul(w.y))
    .add(vec3(z.x, z.y, 0).mul(w.z));
}

/** Sun light arriving at a surface point: star colour through the atmosphere, zero on the night side. */
function sunAtSurface(shading: PlanetShading, up: Vec3Node, radiusAtPoint: FloatNode): Vec3Node {
  const muSun = dot(up, shading.sunDir);
  const atm = shading.atmosphere;
  if (!atm) return shading.sunColor.mul(smoothstep(-0.005, 0.005, muSun));
  const lut = texture(atm.transmittance.texture);
  return shading.sunColor.mul(
    atmSunAtSurface({
      tex: lut,
      smp: sampler(lut),
      r: radiusAtPoint,
      mu: muSun,
      Rg: float(atm.groundRadius),
      Rt: float(atm.topRadius),
    }),
  );
}

export function createTerrainMaterial(shading: PlanetShading): THREE.NodeMaterial {
  const { body, detailTexture } = shading;
  const pal = body.palette;
  const material = new THREE.MeshBasicNodeMaterial();
  material.name = `terrain:${body.name}`;

  const surface = attribute<'vec2'>('surface', 'vec2');
  const height = surface.x;
  const moisture = surface.y;
  const vLocal = varying(positionLocal, 'vLocal');
  const vNormal = varying(normalLocal, 'vNormal');
  const center = chunkCenterNode();
  const detailP = vLocal.add(detailOffsetNode());

  const up = normalize(vLocal.add(center));
  const nGeom = normalize(vNormal);
  const dist = positionWorld.sub(cameraPosition).length();
  const w = triplanarWeights(nGeom);

  // --- detail: three octaves of tileable relief (6 m, 64 m, 1024 m tiles)
  const dFine = triplanar(detailTexture, detailP.div(6), w);
  const dMid = triplanar(detailTexture, detailP.div(64), w);
  const dCoarse = triplanar(detailTexture, detailP.div(1024), w);
  const fineFade = smoothstep(400, 40, dist);
  const bump = triplanarBump(detailTexture, detailP.div(6), w)
    .mul(fineFade.mul(0.55))
    .add(triplanarBump(detailTexture, detailP.div(64), w).mul(0.45))
    .add(triplanarBump(detailTexture, detailP.div(1024), w).mul(0.35));
  const dn = dFine.z.mul(0.25).add(dMid.z.mul(0.35)).add(dCoarse.z.mul(0.4));
  const grain = dFine.w.mul(0.5).add(dMid.w.mul(0.5));

  // --- regional variation at ~100 km and ~15 km
  const region = mx_fractal_noise_float(up.mul(55), 4, 2.1, 0.55);
  const region2 = mx_fractal_noise_float(up.mul(420), 3, 2.1, 0.5);

  const slope = float(1).sub(dot(nGeom, up));
  const slopeN = slope.add(dn.sub(0.5).mul(0.16));
  const lat = dot(up, shading.axis).abs();
  const hN = height.add(region.mul(350)).add(dn.sub(0.5).mul(90));

  // --- region: the biome grid looked up by climate (see universe/biome.ts)
  const climate = body.biomes.climate;
  const tIndex = float(climate.equator)
    .sub(lat.mul(lat).mul(climate.latitudeDrop))
    .sub(hN.max(0).div(climate.lapseHeight))
    .add(region2.mul(0.035));
  const wIndex = moisture.add(region.mul(0.07)).add(dn.sub(0.5).mul(0.05));
  const biomeUv = vec2(wIndex, tIndex).clamp(0.03, 0.97);
  const biomeColor = texture(shading.biomes.color, biomeUv);
  const biomeCover = texture(shading.biomes.cover, biomeUv);
  // Cover edges follow the fine noise, so regions meet in patches rather than along smooth curves.
  const patchy = (amount: FloatNode): FloatNode => smoothstep(0.3, 0.7, amount.add(grain.sub(0.5).mul(0.6)));

  let albedo: Vec3Node = biomeColor.xyz.mul(mix(float(0.9), float(1.12), smoothstep(0, 2600, hN)));
  albedo = mix(albedo, vec3(...pal.highland), smoothstep(2800, 6000, hN).mul(0.55));
  albedo = albedo.mul(region2.mul(0.18).add(1)).mul(region.mul(0.12).add(1));

  // --- photographic ground layers
  // Each layer contributes detail relative to its own mean colour (its last mip), so the palette
  // decides the hue and the photograph supplies the structure. Two tile sizes cross-fade with
  // distance to hide repetition; normals come from the near tile only.
  const farBlend = smoothstep(35, 320, dist);
  const sampleLayer = (set: TextureSet, tile: number, farTile: number | null) => {
    const mean = texture(set.albedo, vec2(0.5, 0.5)).level(float(10)).xyz.max(0.02);
    let detail: Vec3Node = triplanar(set.albedo, detailP.div(tile), w).xyz.div(mean);
    if (farTile !== null)
      detail = mix(detail, triplanar(set.albedo, detailP.div(farTile), w).xyz.div(mean), farBlend);
    return { detail: detail.clamp(0.25, 2.4), bump: triplanarBump(set.normal, detailP.div(tile), w) };
  };
  const tx = shading.textures.sets;
  const groundLayer = sampleLayer(tx.ground, 5, 85);
  albedo = albedo.mul(groundLayer.detail);
  let layerBump: Vec3Node = groundLayer.bump;

  // --- ground cover chosen by the region
  const hasOcean = body.ocean ? 1 : 0;
  const covers = new Set(body.biomes.biomes.map((b) => b.cover));

  // Living cover (grass, moss, lichen): the region colour with a mown-to-seeding variation.
  if (covers.has('grass')) {
    const veg = patchy(biomeCover.x).mul(float(1).sub(smoothstep(0.1, 0.34, slopeN)));
    const vegColor = mix(biomeColor.xyz, biomeColor.xyz.mul(vec3(1.5, 1.25, 0.7)), grain).mul(
      dn.mul(0.9).add(0.55),
    );
    const grassLayer = sampleLayer(tx.grass, 7, 110);
    albedo = mix(albedo, vegColor.mul(grassLayer.detail), veg);
    layerBump = mix(layerBump, grassLayer.bump, veg);
  }

  // Loose sand: sandy regions wherever the ground is not steep, and beaches by any sea.
  const beach = float(hasOcean).mul(float(1).sub(smoothstep(3, 22, height.add(dn.sub(0.5).mul(14)))));
  if (covers.has('sand') || body.ocean) {
    const sandMask = max(patchy(biomeCover.y).mul(float(1).sub(smoothstep(0.05, 0.3, slopeN))), beach);
    const sandColor = mix(biomeColor.xyz, vec3(...pal.sand), beach).mul(dn.mul(0.35).add(0.82));
    const sandLayer = sampleLayer(tx.sand, 3, null);
    albedo = mix(albedo, sandColor.mul(sandLayer.detail), sandMask);
    layerBump = mix(layerBump, sandLayer.bump, sandMask);
  }

  // Rock and cliffs on slopes, with strata lines on the steep faces.
  const rockMask = smoothstep(0.16, 0.4, slopeN);
  const strata = height.div(14).add(dMid.w.mul(6)).sin().mul(0.5).add(0.5);
  const rockColor = mix(vec3(...pal.rock), vec3(...pal.cliff), smoothstep(0.42, 0.75, slopeN))
    .mul(dn.mul(0.6).add(0.7))
    .mul(strata.mul(0.22).add(0.89));
  const rockLayer = sampleLayer(tx.rock, 9, 140);
  albedo = mix(albedo, rockColor.mul(rockLayer.detail), rockMask);
  layerBump = mix(layerBump, rockLayer.bump.mul(1.4), rockMask);

  // Sea floor: sediment, darker with depth.
  if (hasOcean) {
    const under = smoothstep(2, -30, height);
    albedo = mix(albedo, vec3(...pal.sand).mul(0.55), under.mul(0.8));
  }

  // Snow and ice: frozen regions, lying on everything but the steepest faces.
  let snow: FloatNode = float(0);
  if (covers.has('snow')) {
    snow = patchy(biomeColor.w).mul(float(1).sub(smoothstep(0.38, 0.7, slopeN)));
    const snowLayer = sampleLayer(tx.snow, 6, null);
    albedo = mix(
      albedo,
      biomeColor.xyz.mul(dn.mul(0.12).add(0.9)).mul(snowLayer.detail.clamp(0.7, 1.15)),
      snow,
    );
    layerBump = mix(layerBump, snowLayer.bump.mul(0.6), snow);
  }

  // Real bodies: the measured colour replaces the generated palette; the photographed ground
  // layers still supply structure below the map's resolution (about 2.7 km per texel on the Moon).
  if (shading.surfaceMap) {
    const meridian = shading.surfaceMap.heightmap.meridian;
    const longitude = atan(up.z.negate(), up.x).sub(meridian);
    const mapUv = vec2(fract(longitude.div(Math.PI * 2).add(0.5)), acos(up.y.clamp(-1, 1)).div(Math.PI));
    // Close to the ground one texel of the map covers kilometres and would show as blocks: there
    // the lookup widens to a five-tap average, which keeps the regional colour and drops the grid.
    const map = shading.surfaceMap.albedo;
    const image = map.image as { width: number; height: number };
    const du = vec2(MAP_SMOOTH_TEXELS / image.width, 0);
    const dv = vec2(0, MAP_SMOOTH_TEXELS / image.height);
    const sharp = texture(map, mapUv).xyz;
    const smooth = sharp
      .add(texture(map, mapUv.add(du)).xyz)
      .add(texture(map, mapUv.sub(du)).xyz)
      .add(texture(map, mapUv.add(dv)).xyz)
      .add(texture(map, mapUv.sub(dv)).xyz)
      .div(5);
    const measured = mix(sharp, smooth, smoothstep(MAP_SMOOTH_FAR_M, MAP_SMOOTH_NEAR_M, dist));
    const structure = mix(groundLayer.detail, rockLayer.detail, rockMask).clamp(0.55, 1.6);
    // The mosaic is stretched for display; scale it back toward the true (dark) reflectance.
    albedo = measured.mul(shading.surfaceMap.albedoGain).mul(structure).mul(dn.mul(0.3).add(0.85));
    snow = float(0);
  }

  // Final shading normal: geometric normal + procedural relief + the photographed micro-surface
  // (which fades with distance, where it would only alias).
  const N = normalize(nGeom.add(bump.mul(0.3)).add(layerBump.mul(smoothstep(260, 20, dist).mul(0.85))));

  // --- lighting
  const L = shading.sunDir;
  const sun = sunAtSurface(shading, up, float(shading.radius).add(height));
  const nDotL = max(dot(N, L), 0);
  // Wrap the geometric terminator slightly so micro relief does not light the night side.
  const horizonFade = smoothstep(-0.06, 0.1, dot(nGeom, L));
  const diffuse = albedo.mul(sun).mul(nDotL).mul(horizonFade);

  const skyVis = dot(N, up).mul(0.5).add(0.5);
  const cavity = dn.mul(0.5).add(0.6);
  const ambient = albedo.mul(shading.skyColor.mul(skyVis).add(shading.sunColor.mul(0.004))).mul(cavity);

  // Snow / wet sand glint.
  const V = normalize(cameraPosition.sub(positionWorld));
  const H = normalize(L.add(V));
  const gloss = snow.mul(0.35).add(beach.mul(0.25));
  const specular = sun
    .mul(pow(max(dot(N, H), 0), 48))
    .mul(gloss)
    .mul(nDotL);

  let color: Vec3Node = diffuse.add(ambient).add(specular);

  // --- headlamp: a warm cone from the robot, the only light on a moonless night side
  const toLamp = shading.lamp.xyz.sub(positionWorld);
  const lampDist = toLamp.length().max(0.5);
  const lampL = toLamp.div(lampDist);
  const cone = smoothstep(0.72, 0.93, dot(lampL.negate(), shading.lampDir));
  const lampLight = shading.lamp.w
    .mul(cone)
    .mul(max(dot(N, lampL), 0).mul(0.8).add(0.2))
    .div(lampDist.mul(lampDist).mul(0.004).add(1));
  color = color.add(albedo.mul(vec3(1, 0.93, 0.8)).mul(lampLight));

  // --- emissive (lava fissures in the lowlands)
  if (pal.emissive[0] + pal.emissive[1] + pal.emissive[2] > 0) {
    const crack = pow(float(1).sub(dMid.z.sub(0.5).abs().mul(2)), 10).add(
      pow(float(1).sub(dCoarse.z.sub(0.5).abs().mul(2)), 14),
    );
    // Ember regions glow through far more fissures than cooled ground.
    const heat = smoothstep(900, -200, hN)
      .mul(crack)
      .mul(region2.mul(0.5).add(0.75))
      .mul(biomeCover.z.mul(3).add(0.35));
    color = color.add(
      vec3(...pal.emissive)
        .mul(heat)
        .mul(9),
    );
  }

  // --- survey pulse: a bright wavefront sweeping outward, leaving fading elevation contours behind it
  const scanDist = positionWorld.sub(shading.scan.xyz).length();
  const front = smoothstep(shading.scan.w.mul(0.02).add(0.6), 0, scanDist.sub(shading.scan.w).abs());
  const behind = smoothstep(shading.scan.w.mul(0.35), shading.scan.w, scanDist).mul(
    scanDist.lessThan(shading.scan.w).select(1, 0),
  );
  const contour = smoothstep(0.12, 0, height.div(4).fract().sub(0.5).abs().sub(0.38).abs());
  const fadeOut = float(1).sub(shading.scan.w.div(shading.scanRange)).clamp(0, 1);
  const pulse = front
    .mul(0.9)
    .add(behind.mul(contour).mul(0.45))
    .mul(fadeOut)
    .mul(shading.scan.w.greaterThan(0).select(1, 0));
  color = color.add(vec3(0.15, 0.95, 0.8).mul(pulse));

  material.colorNode = vec4(color, 1);
  return material;
}

/**
 * Gas / ice giant cloud deck: latitudinal bands sheared by zonal jets, turbulent band edges, fine
 * streaks and a few long-lived storm ovals. Drawn on the (relief-free) terrain quadtree so it holds
 * up from orbit down to skimming the cloud tops.
 */
export function createGiantMaterial(shading: PlanetShading): THREE.NodeMaterial {
  const { body } = shading;
  const bands = body.bands ?? [[0.8, 0.7, 0.6]];
  const material = new THREE.MeshBasicNodeMaterial();
  material.name = `giant:${body.name}`;
  const seed = (body.seed % 997) * 0.37;

  const vLocal = varying(positionLocal, 'vLocal');
  const up = normalize(vLocal.add(chunkCenterNode()));
  const axis = shading.axis;
  const lat = dot(up, axis);
  // Coordinates around the axis, for longitudinal structure.
  const east = normalize(axis.cross(vec3(0.3, 0.1, 0.9)));
  const north = axis.cross(east);
  const eq = vec3(dot(up, east), lat, dot(up, north));

  // Turbulent displacement of the band boundaries; jets alternate direction with latitude.
  const warp = mx_fractal_noise_float(eq.mul(vec3(3, 9, 3)).add(seed), 4, 2.1, 0.55);
  const curl = mx_fractal_noise_float(eq.mul(vec3(11, 30, 11)).add(seed + 17), 3, 2.2, 0.5);
  const latW = lat.add(warp.mul(0.035)).add(curl.mul(0.012));
  const bandCount = body.kind === 'iceGiant' ? 5 : 11;
  const bandPos = latW.mul(bandCount).add(mx_noise_float(vec2(latW.mul(3), seed)).mul(1.5));

  // Smooth walk through the palette along latitude.
  const t = mx_noise_float(vec2(bandPos, seed + 5))
    .mul(0.5)
    .add(0.5)
    .mul(bands.length - 1);
  let color: Vec3Node = vec3(...bands[0]);
  for (let i = 1; i < bands.length; i++) {
    color = mix(color, vec3(...bands[i]), smoothstep(i - 1, i, t));
  }
  // Streaks stretched along the flow.
  const streaks = mx_fractal_noise_float(
    eq
      .mul(vec3(6, 140, 6))
      .add(vec3(curl.mul(0.6), 0, 0))
      .add(seed + 31),
    4,
    2.0,
    0.55,
  );
  color = color.mul(streaks.mul(0.16).add(1));

  // Storm ovals: anticyclones at fixed positions, each a brighter core with a darker collar.
  const stormCount = body.kind === 'iceGiant' ? 1 : 3;
  for (let i = 0; i < stormCount; i++) {
    const a = seed * (i + 1.7) * 2.1;
    const sLat = Math.sin(a * 1.3) * 0.45;
    const c = Math.sqrt(1 - sLat * sLat);
    const centre = vec3(Math.cos(a) * c, sLat, Math.sin(a) * c);
    const d = eq
      .sub(centre)
      .mul(vec3(1, 2.2, 1))
      .length()
      .div(0.07 + 0.05 * ((i * 7) % 3));
    const swirl = mx_noise_float(eq.mul(60).add(d.mul(4))).mul(0.25);
    const core = smoothstep(1, 0.2, d.add(swirl));
    const collar = smoothstep(1.5, 1.0, d).mul(smoothstep(0.7, 1.0, d));
    color = mix(color, vec3(...bands[(i + 1) % bands.length]).mul(1.25), core.mul(0.8));
    color = color.mul(float(1).sub(collar.mul(0.25)));
  }

  // Lighting: thick cloud deck, soft terminator, limb darkening toward the edge of the lit disc.
  const L = shading.sunDir;
  const sun = sunAtSurface(shading, up, float(shading.radius));
  const nDotL = max(dot(up, L), 0);
  let lit: Vec3Node = color.mul(sun).mul(pow(nDotL, float(0.8)));

  // Ring shadow: follow the ray toward the star to the ring plane and look up the ring's opacity there.
  if (body.rings) {
    const ring = body.rings;
    const P = up.mul(shading.radius);
    const denom = dot(L, axis);
    const tHit = dot(P, axis).negate().div(denom);
    const hit = P.add(L.mul(tHit));
    const x = hit
      .length()
      .sub(ring.innerRadius)
      .div(ring.outerRadius - ring.innerRadius);
    const inRing = tHit.greaterThan(0).and(x.greaterThan(0)).and(x.lessThan(1));
    const shade = inRing.select(ringProfile(x.clamp(0, 1), ring).mul(ring.opacity * 0.9), float(0));
    lit = lit.mul(float(1).sub(shade));
  }
  material.colorNode = vec4(lit.add(color.mul(shading.skyColor).mul(0.5)), 1);
  return material;
}

export function createWaterMaterial(shading: PlanetShading): THREE.NodeMaterial {
  const { body, detailTexture } = shading;
  const ocean = body.ocean;
  if (!ocean) throw new Error('createWaterMaterial: body has no ocean');
  const material = new THREE.MeshBasicNodeMaterial();
  material.name = `water:${body.name}`;

  const depth = attribute<'float'>('depth', 'float');
  const vLocal = varying(positionLocal, 'vLocal');
  const center = chunkCenterNode();
  const detailP = vLocal.add(detailOffsetNode());
  const up = normalize(vLocal.add(center));
  const w = triplanarWeights(up);
  const dist = positionWorld.sub(cameraPosition).length();

  // Wind waves: scrolling detail normals at four scales; the fine ones fade with distance.
  const t = time.mul(ocean.waveScale);
  const flow = vec3(1, 0.3, 0.7);
  const b1 = triplanarBump(detailTexture, detailP.div(5).add(flow.mul(t.mul(0.09))), w);
  const b2 = triplanarBump(detailTexture, detailP.div(23).sub(flow.mul(t.mul(0.045))), w);
  const b3 = triplanarBump(detailTexture, detailP.div(128).add(flow.yzx.mul(t.mul(0.02))), w);
  const b4 = triplanarBump(detailTexture, detailP.div(1024).sub(flow.zxy.mul(t.mul(0.006))), w);
  const near = smoothstep(900, 30, dist);
  const bump = b1.mul(near.mul(0.55)).add(b2.mul(0.5)).add(b3.mul(0.4)).add(b4.mul(0.3));
  const N = normalize(up.add(bump.mul(0.22 * ocean.waveScale)));

  const L = shading.sunDir;
  const V = normalize(cameraPosition.sub(positionWorld));
  const sun = sunAtSurface(shading, up, float(shading.radius));
  const nDotV = clamp(dot(N, V), 0, 1);
  const fresnel = float(0.02).add(float(0.98).mul(pow(float(1).sub(nDotV), 5)));

  // Body colour: scattering in the water column, shallow water shows the bed tint.
  const absorb = exp(depth.max(0).div(-18));
  const body3 = mix(vec3(...ocean.deepColor), vec3(...ocean.shallowColor), absorb);
  const dayLight = sun.mul(max(dot(up, L), 0)).add(shading.skyColor);
  const scatter = body3.mul(dayLight).mul(0.9);

  // Sky reflection (analytic: brighter toward the horizon) and sun glitter.
  const R = V.negate().reflect(N);
  const skyRefl = shading.skyColor.mul(
    mix(float(1.2), float(3.2), pow(float(1).sub(clamp(dot(R, up), 0, 1)), 3)),
  );
  const H = normalize(L.add(V));
  // Unresolved waves widen the highlight with distance (the glitter path seen from orbit).
  const roughness = mix(float(0.07), float(0.24), smoothstep(200, 400000, dist));
  const a2 = roughness.mul(roughness);
  const nDotH = clamp(dot(N, H), 0, 1);
  const d = nDotH.mul(nDotH).mul(a2.sub(1)).add(1);
  const ggx = a2.div(d.mul(d).mul(Math.PI));
  // Clamped: the true peak is thousands of times the sky and would turn into a bloom blob.
  const glitter = sun
    .mul(ggx.mul(0.25).min(2.2))
    .mul(max(dot(N, L), 0))
    .mul(fresnel.mul(6).add(0.25));

  // Shore foam where the water is very shallow.
  const foamNoise = triplanar(detailTexture, detailP.div(9).add(flow.mul(t.mul(0.05))), w).w;
  const foam = smoothstep(1.6, 0.0, depth.add(foamNoise.sub(0.5).mul(1.6))).mul(
    smoothstep(0.3, 0.6, foamNoise.add(0.2)),
  );

  let color: Vec3Node = mix(scatter, skyRefl, fresnel).add(glitter);
  color = mix(color, dayLight.mul(0.85), foam.mul(0.8));
  if (ocean.emissive > 0) {
    // Molten surfaces are mostly dark crust; the glow shows through the seams between drifting
    // plates. Far away the seams are unresolved, so the pattern settles to its mean coverage.
    const plates = triplanar(detailTexture, detailP.div(180).add(flow.mul(t.mul(0.004))), w).z;
    const seams = pow(float(1).sub(plates.sub(0.5).abs().mul(2)), 5);
    const glow = mix(seams, float(0.08), smoothstep(1500, 30000, dist));
    color = color
      .mul(0.2)
      .add(mix(vec3(...ocean.deepColor).mul(0.02), vec3(...ocean.shallowColor), glow).mul(ocean.emissive));
  }
  material.colorNode = vec4(color, 1);
  // The sheet spans its whole chunk, under the land too. Seen from orbit the depth buffer cannot
  // separate it from lowlands a few tens of metres above it, so the part under land is cut away.
  material.maskNode = depth.greaterThan(-0.5);
  return material;
}

export function estimateSkyColor(body: BodyDesc, sunColor: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  const atm = body.atmosphere;
  if (!atm) return out.set(0, 0, 0);
  // Chromaticity of the scattered light: Rayleigh colour plus a share of neutral Mie haze.
  const r = color3(atm.rayleigh);
  const mie = atm.mie * 0.6;
  r.set(
    r.x + mie * (1 - atm.mieAbsorption[0]),
    r.y + mie * (1 - atm.mieAbsorption[1]),
    r.z + mie * (1 - atm.mieAbsorption[2]),
  );
  const m = Math.max(r.x, r.y, r.z, 1e-12);
  // Optical thickness of the zenith column decides how bright the sky dome is.
  const tau = Math.min(1, (m * atm.rayleighScaleHeight) / 0.25);
  return out
    .copy(r)
    .multiplyScalar((0.085 * tau) / m)
    .multiply(sunColor);
}
