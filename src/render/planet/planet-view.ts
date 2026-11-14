// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
/**
 * Everything needed to draw one solid body: terrain quadtree, ocean, shading uniforms and the
 * atmosphere model. Created when the body becomes large enough on screen, disposed when it shrinks
 * back to a point (see SystemView).
 */
import * as THREE from 'three/webgpu';
import { type Disposable, DisposableStore } from '@/core/disposable';
import type { Engine } from '@/engine/engine';
import type { TerrainTextures } from '@/engine/terrain-textures';
import { AtmosphereModel } from '@/render/atmosphere/atmosphere-model';
import { TerrainField } from '@/universe/terrain-field';
import type { BodyDesc } from '@/universe/types';
import { createBiomeTextures } from './biome-texture';
import {
  createGiantMaterial,
  createTerrainMaterial,
  createWaterMaterial,
  estimateSkyColor,
  PlanetShading,
} from './planet-materials';
import { PlanetTerrain } from './planet-terrain';
import { RingView } from './ring-view';
import type { SurfaceMaps } from './surface-maps';
import { SurfaceScatter } from './surface-scatter';
import type { TerrainWorkerPool } from './terrain-worker-pool';

export interface PlanetViewDeps {
  engine: Engine;
  pool: TerrainWorkerPool;
  detailTexture: THREE.Texture;
  terrainTextures: TerrainTextures;
  /** Measured maps of real bodies; null in generated systems. */
  surfaceMaps: SurfaceMaps | null;
}

export class PlanetView implements Disposable {
  readonly atmosphere: AtmosphereModel | null;
  readonly terrain: PlanetTerrain;
  readonly shading: PlanetShading;
  /** Main-thread copy of the height field, for altitude and collision queries. */
  readonly field: TerrainField;
  /** Extra sky radiance for this frame (lightning). Set by the app before `update`. */
  flash = 0;
  private rings: RingView | null = null;
  private scatter: SurfaceScatter | null = null;
  private readonly store = new DisposableStore();
  private readonly rel = new THREE.Vector3();
  private readonly sky = new THREE.Vector3();

  constructor(
    readonly body: BodyDesc,
    deps: PlanetViewDeps,
  ) {
    const surfaceMap = deps.surfaceMaps?.get(body) ?? null;
    if (surfaceMap) deps.pool.setHeightmap(body.id, surfaceMap.heightmap);
    this.field = new TerrainField(body.terrain, body.radius, surfaceMap?.heightmap ?? null);
    this.atmosphere = body.atmosphere
      ? this.store.add(new AtmosphereModel(body.atmosphere, body.radius))
      : null;
    if (this.atmosphere) deps.engine.lutBaker.bake(this.atmosphere);

    const biomeTextures = createBiomeTextures(body.biomes);
    this.store.add(biomeTextures.color);
    this.store.add(biomeTextures.cover);
    this.shading = new PlanetShading(
      body,
      this.atmosphere,
      deps.detailTexture,
      deps.terrainTextures,
      biomeTextures,
      surfaceMap,
    );
    const giant = body.bands !== null;
    const terrainMaterial = this.store.add(
      giant ? createGiantMaterial(this.shading) : createTerrainMaterial(this.shading),
    );
    const waterMaterial = body.ocean ? this.store.add(createWaterMaterial(this.shading)) : null;
    this.terrain = this.store.add(new PlanetTerrain(body, deps.pool, terrainMaterial, waterMaterial));
    deps.engine.scene.add(this.terrain.group);
    if (!giant) {
      this.scatter = this.store.add(new SurfaceScatter(body, this));
      deps.engine.scene.add(this.scatter.group);
    }
    if (body.rings) {
      this.rings = this.store.add(new RingView(body, this.shading));
      deps.engine.scene.add(this.rings.mesh);
    }
  }

  /**
   * @param cameraLocal camera relative to the body centre.
   * @param sunDir unit direction from the body to the star.
   * @param sunColor star colour × illuminance at this body.
   */
  update(cameraLocal: THREE.Vector3, sunDir: THREE.Vector3, sunColor: THREE.Vector3, refine: boolean): void {
    this.shading.sunDir.value.copy(sunDir);
    this.shading.sunColor.value.copy(sunColor);
    // Ambient follows the sun's elevation at the camera's location: bright at noon, gone at night.
    const up = cameraLocal.length() > 0 ? cameraLocal.dot(sunDir) / cameraLocal.length() : 1;
    const day = THREE.MathUtils.smoothstep(up, -0.25, 0.3);
    estimateSkyColor(this.body, sunColor, this.sky).multiplyScalar(day);
    this.shading.skyColor.value.copy(this.sky).addScalar(this.flash);
    this.terrain.update(cameraLocal, refine);
    this.rings?.update(this.rel.copy(cameraLocal).negate());
  }

  /** Streams boulders / vegetation around the craft. Positions are relative to the body centre. */
  updateScatter(dt: number, craftLocal: THREE.Vector3, cameraLocal: THREE.Vector3, altitude: number): void {
    this.scatter?.update(dt, craftLocal, cameraLocal, altitude);
  }

  /** Breaks the nearest boulder within reach of the drill. Returns true if one broke. */
  breakBoulder(craftLocal: THREE.Vector3, reach: number): boolean {
    return this.scatter?.breakNearest(craftLocal, reach) ?? false;
  }

  /**
   * Drives the survey pulse drawn on the terrain.
   * @param origin pulse centre relative to the camera, or null to switch it off.
   */
  setScanPulse(origin: THREE.Vector3 | null, radius: number, range: number): void {
    const scan = this.shading.scan.value;
    if (!origin) {
      scan.w = -1;
      return;
    }
    scan.set(origin.x, origin.y, origin.z, Math.max(radius, 0.01));
    this.shading.scanRange.value = range;
  }

  /**
   * Aims the robot's headlamp at the terrain.
   * @param origin lamp position relative to the camera; @param intensity 0 switches it off.
   */
  setLamp(origin: THREE.Vector3, direction: THREE.Vector3, intensity: number): void {
    this.shading.lamp.value.set(origin.x, origin.y, origin.z, intensity);
    this.shading.lampDir.value.copy(direction);
  }

  /** Terrain height above the datum radius along `dir` (unit vector, planet-local). */
  heightAt(dir: THREE.Vector3): number {
    return this.field.height(dir.x, dir.y, dir.z, 1);
  }

  /** Height of whatever the player would stand on: terrain or the ocean surface. */
  surfaceHeightAt(dir: THREE.Vector3): number {
    const h = this.heightAt(dir);
    return this.body.ocean ? Math.max(h, 0) : h;
  }

  dispose(): void {
    this.store.dispose();
  }
}
