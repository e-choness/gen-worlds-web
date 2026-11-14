/**
 * The galaxy as seen from inside it: an equirectangular HDR panorama produced by ray-marching the
 * same analytic density model that places the stars (`universe/galaxy.ts`), with dust extinction.
 * Baked on the GPU whenever the observer has moved far enough for the view to change, then drawn
 * on a background sphere together with a procedural field of faint unresolved stars.
 *
 * Technique lineage: the spiral-arm particle distribution of dgreenheck/webgpu-galaxy, turned into a
 * volumetric integral so it holds up from any vantage point.
 */

import { equirectUV, normalize, positionLocal, texture, uniform, uv, vec4 } from 'three/tsl';
import * as THREE from 'three/webgpu';
import type { Disposable } from '@/core/disposable';
import { wgsl } from '@/engine/tsl';
import { gxHash, gxNoise } from '@/engine/wgsl-noise';
import { GALAXY_RADIUS_LY, GALAXY_THICKNESS_LY } from '@/universe/constants';
import type { GalaxyParams } from '@/universe/galaxy';

const gxFbm = wgsl<'float'>(
  /* wgsl */ `
fn gxFbm(p: vec3<f32>) -> f32 {
  var s = 0.0;
  var a = 0.5;
  var q = p;
  for (var i = 0; i < 4; i++) {
    s += a * gxNoise(q);
    q = q * 2.07 + vec3<f32>(13.1, 7.7, 3.3);
    a *= 0.5;
  }
  return s;
}`,
  [gxNoise],
);

/**
 * Mirrors Galaxy.density(). G = (arm count, winding, arm width, radius), thickness in T.
 * Returns (disk density, bulge density, arm factor 0..1).
 */
const gxDensity = wgsl<'vec3'>(/* wgsl */ `
fn gxDensity(p: vec3<f32>, G: vec4<f32>, T: f32) -> vec3<f32> {
  let R = G.w;
  let r = length(p.xz);
  let rn = r / R;
  if (rn > 1.25) { return vec3<f32>(0.0); }
  let disk = exp(-(r - R * 0.5) / (R * 0.22));
  let h = T * (0.35 + 0.65 * exp(-rn * 3.0));
  let c = cosh(p.y / h);
  let vertical = 1.0 / (c * c);
  let theta = atan2(p.z, p.x);
  let phase = (theta - G.y * log(max(r, 1.0) / (R * 0.08))) * G.x;
  let arm = exp((cos(phase) - 1.0) / (G.z * G.z));
  let armMix = 0.25 + 1.5 * arm * smoothstep(0.06, 0.2, rn);
  let bulgeR = length(vec2<f32>(r, p.y * 1.6)) / (R * 0.09);
  let bulge = 60.0 * exp(-bulgeR * bulgeR);
  let rim = 1.0 - smoothstep(0.9, 1.2, rn);
  return vec3<f32>(disk * armMix * vertical * rim, bulge * rim, arm);
}`);

const gxBackdrop = wgsl<'vec4'>(
  /* wgsl */ `
fn gxBackdrop(uv: vec2<f32>, origin: vec3<f32>, G: vec4<f32>, T: f32) -> vec4<f32> {
  let phi = (uv.x - 0.5) * 6.28318530718;
  let lat = (uv.y - 0.5) * 3.14159265359;
  let dir = vec3<f32>(cos(lat) * cos(phi), sin(lat), cos(lat) * sin(phi));
  let STEPS = 96;
  let reach = G.w * 2.4;
  var tPrev = 0.0;
  var tau = 0.0;
  var L = vec3<f32>(0.0);
  for (var i = 0; i < STEPS; i++) {
    let f = (f32(i) + 1.0) / f32(STEPS);
    let tNext = reach * f * f;
    let dt = tNext - tPrev;
    let p = origin + dir * (tPrev + dt * 0.5);
    tPrev = tNext;
    let d = gxDensity(p, G, T);
    if (d.x + d.y <= 0.0) { continue; }
    // Dust hugs the mid-plane and the arms; clumpy on several scales.
    let hd = T * 0.16;
    // The dust sheet is warped, not a perfect plane.
    let warp = (gxFbm(p / 2600.0) - 0.47) * T * 0.55;
    let cd = cosh((p.y - warp) / hd);
    let clump = gxFbm(p / 900.0) * 1.4 + gxFbm(p / 160.0) * 0.6;
    let dust = d.x * (0.35 + 1.4 * d.z) * clump / (cd * cd) * 2.6;
    let trans = exp(-tau - dust * dt * 0.5e-4);
    tau += dust * dt * 1.0e-4;
    // Young blue stars in the arms, old yellow population in the bulge and inter-arm disk.
    let young = vec3<f32>(0.72, 0.84, 1.0);
    let old = vec3<f32>(1.0, 0.8, 0.56);
    let diskColor = mix(old, young, clamp(d.z * 1.3, 0.0, 1.0));
    // Emission nebulae: sparse pink knots along the arms.
    let knots = smoothstep(0.62, 0.8, gxNoise(p / 420.0)) * d.z * d.z;
    let emit = diskColor * d.x + old * d.y * 0.2 + vec3<f32>(1.0, 0.3, 0.45) * knots * d.x * 2.5;
    L += emit * trans * dt;
  }
  return vec4<f32>(L * 5.5e-6, 1.0);
}`,
  [gxDensity, gxFbm, gxNoise],
);

/** Faint unresolved stars: two layers of jittered cells on the direction sphere. */
const gxGrain = wgsl<'vec3'>(
  /* wgsl */ `
fn gxGrain(dir: vec3<f32>, band: f32) -> vec3<f32> {
  var total = vec3<f32>(0.0);
  for (var layer = 0; layer < 3; layer++) {
    let scale = 190.0 + f32(layer) * 170.0;
    let p = dir * scale;
    let cell = floor(p);
    let h = gxHash(cell + f32(layer) * 17.0);
    // More stars where the galaxy is dense behind them.
    let threshold = 0.9 - clamp(band * 2.2, 0.0, 0.45);
    if (h < threshold) { continue; }
    let jitter = vec3<f32>(gxHash(cell + 3.1), gxHash(cell + 7.7), gxHash(cell + 11.3)) * 0.5 + 0.25;
    let d = length(fract(p) - jitter);
    let mag = pow(gxHash(cell + 5.5), 6.0);
    let tint = mix(vec3<f32>(1.0, 0.78, 0.6), vec3<f32>(0.7, 0.82, 1.0), gxHash(cell + 9.9));
    total += tint * smoothstep(0.24, 0.0, d) * (0.05 + mag * 0.9);
  }
  return total;
}`,
  [gxHash],
);

/** Observer displacement (ly) after which the panorama is baked again. */
const REBAKE_DISTANCE_LY = 150;

export class GalaxyBackdrop implements Disposable {
  readonly mesh: THREE.Mesh;
  /** 0..1: stars fade out under a bright daytime sky. */
  readonly visibility = uniform(1);
  private readonly target: THREE.RenderTarget;
  private readonly origin = uniform(new THREE.Vector3());
  private readonly bakeQuad: THREE.QuadMesh;
  private readonly bakeMaterial: THREE.NodeMaterial;
  private readonly bakedAt = new THREE.Vector3(Number.NaN, 0, 0);

  constructor(
    private readonly renderer: THREE.WebGPURenderer,
    params: GalaxyParams,
  ) {
    this.target = new THREE.RenderTarget(2048, 1024, {
      type: THREE.HalfFloatType,
      depthBuffer: false,
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
    });
    this.target.texture.colorSpace = THREE.NoColorSpace;

    const G = uniform(
      new THREE.Vector4(params.armCount, params.armWinding, params.armWidth, GALAXY_RADIUS_LY),
    );
    this.bakeMaterial = new THREE.NodeMaterial();
    this.bakeMaterial.fragmentNode = gxBackdrop({ uv: uv(), origin: this.origin, G, T: GALAXY_THICKNESS_LY });
    this.bakeQuad = new THREE.QuadMesh(this.bakeMaterial);

    const material = new THREE.MeshBasicNodeMaterial();
    const dir = normalize(positionLocal);
    const galaxy = texture(this.target.texture, equirectUV(dir)).xyz;
    const band = galaxy.x.add(galaxy.y).add(galaxy.z).mul(0.333);
    material.colorNode = vec4(galaxy.add(gxGrain({ dir, band })).mul(this.visibility), 1);
    material.side = THREE.BackSide;
    material.depthTest = false;
    material.depthWrite = false;
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(100, 48, 24), material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.name = 'galaxy-backdrop';
  }

  /** @param positionLy observer position in the galaxy, light-years. */
  update(positionLy: THREE.Vector3): void {
    if (this.bakedAt.distanceTo(positionLy) < REBAKE_DISTANCE_LY) return;
    this.bakedAt.copy(positionLy);
    this.origin.value.copy(positionLy);
    const previous = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.target);
    this.bakeQuad.render(this.renderer);
    this.renderer.setRenderTarget(previous);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.bakeMaterial.dispose();
    this.target.dispose();
    this.mesh.removeFromParent();
  }
}
