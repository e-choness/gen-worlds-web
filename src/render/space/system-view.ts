// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0 or MIT: see LICENSE.md.
/**
 * Live representation of one star system: where every body is, which bodies currently have a full
 * renderer, and which atmospheres feed the post pass.
 *
 * Bodies are promoted to a full view (terrain, ocean, atmosphere) when their apparent size passes a
 * threshold and demoted (resources released) when it falls below a lower one. Below that they are
 * drawn as a single lit point.
 */

import { float, uv, vec4 } from 'three/tsl';
import * as THREE from 'three/webgpu';
import { type Disposable, DisposableStore } from '@/core/disposable';
import type { Engine } from '@/engine/engine';
import { SLOT_COUNT } from '@/render/atmosphere/atmosphere-pass';
import { PlanetView, type PlanetViewDeps } from '@/render/planet/planet-view';
import { AU } from '@/universe/constants';
import { solarBodyId, solarBodyPosition } from '@/universe/solar-system';
import type { BodyDesc, SystemDesc, Vec3Tuple } from '@/universe/types';
import { StarView } from './star-view';

/** Apparent angular radius (radians) at which a body gets / loses its full renderer. */
const PROMOTE_ANGLE = 0.0035;
const DEMOTE_ANGLE = 0.0025;

export interface BodyState {
  readonly desc: BodyDesc;
  readonly parent: BodyState | null;
  /** Position in system space (star at the origin), metres, float64. */
  readonly position: THREE.Vector3;
  /** Direction to the star and light arriving from it. */
  readonly sunDir: THREE.Vector3;
  readonly sunColor: THREE.Vector3;
  /**
   * When set, the light direction on this body, replacing the one from its position. A mission
   * sets it from the site sky of the simulation, so the 3D view shows the lighting the mission has.
   */
  sunOverride: THREE.Vector3 | null;
  view: PlanetView | null;
  marker: THREE.Sprite;
  /** Distance from the camera to the body centre, updated every frame. */
  distance: number;
}

export class SystemView implements Disposable {
  readonly bodies: BodyState[] = [];
  readonly star: StarView;
  private readonly store = new DisposableStore();
  private readonly markerMaterials: THREE.SpriteNodeMaterial[] = [];
  private readonly rel = new THREE.Vector3();
  private readonly camLocal = new THREE.Vector3();
  private readonly ephemerisPosition: Vec3Tuple = [0, 0, 0];

  constructor(
    readonly system: SystemDesc,
    private readonly engine: Engine,
    private readonly deps: PlanetViewDeps,
  ) {
    this.star = this.store.add(new StarView(system.star));
    engine.scene.add(this.star.group);
    for (const planet of system.planets) {
      const state = this.addBody(planet, null);
      for (const moon of planet.moons) this.addBody(moon, state);
    }
  }

  private addBody(desc: BodyDesc, parent: BodyState | null): BodyState {
    const position = new THREE.Vector3(Math.cos(desc.orbitPhase), 0, Math.sin(desc.orbitPhase))
      .applyAxisAngle(new THREE.Vector3(1, 0, 0), desc.orbitInclination)
      .multiplyScalar(desc.orbitRadius);
    if (parent) position.add(parent.position);

    const star = this.system.star;
    const distAu = position.length() / AU;
    // Perceptual compression of the inverse-square law: outer planets are dimmer but never black.
    const illuminance =
      3.4 * THREE.MathUtils.clamp((star.luminositySolar / (distAu * distAu)) ** 0.2, 0.4, 2.4);
    const sunColor = new THREE.Vector3(...star.color).multiplyScalar(illuminance);

    const material = new THREE.SpriteNodeMaterial();
    const r = uv().sub(0.5).length().mul(2);
    const tint = desc.bands ? desc.bands[0] : desc.palette.midland;
    material.colorNode = vec4(tint[0] * 6, tint[1] * 6, tint[2] * 6, 1).mul(
      float(1).sub(r).clamp(0, 1).pow(2),
    );
    material.transparent = true;
    material.blending = THREE.AdditiveBlending;
    material.depthWrite = false;
    this.markerMaterials.push(material);
    const marker = new THREE.Sprite(material);
    this.engine.scene.add(marker);

    const state: BodyState = {
      desc,
      parent,
      position,
      sunDir: position.clone().normalize().negate(),
      sunColor,
      sunOverride: null,
      view: null,
      marker,
      distance: Number.POSITIVE_INFINITY,
    };
    this.bodies.push(state);
    return state;
  }

  /**
   * Moves the bodies of the real solar system to where they are at Julian date `jd`. Does nothing
   * for generated systems, whose bodies stay at their orbit phase.
   */
  setEpoch(jd: number): void {
    if (!this.system.real) return;
    const p = this.ephemerisPosition;
    for (const body of this.bodies) {
      const id = solarBodyId(body.desc);
      if (!id || !solarBodyPosition(id, jd, p)) continue;
      body.position.set(p[0], p[1], p[2]);
      if (body.sunOverride) body.sunDir.copy(body.sunOverride);
      else body.sunDir.copy(body.position).normalize().negate();
    }
  }

  /** The body whose surface is closest to `position` (system space). */
  nearestBody(position: THREE.Vector3): BodyState | null {
    let best: BodyState | null = null;
    let bestAlt = Number.POSITIVE_INFINITY;
    for (const body of this.bodies) {
      const alt = body.position.distanceTo(position) - body.desc.radius;
      if (alt < bestAlt) {
        bestAlt = alt;
        best = body;
      }
    }
    return best;
  }

  /**
   * @param camera camera position in system space, float64.
   * @param time seconds since start, drives cloud drift.
   */
  update(camera: THREE.Vector3, time: number): void {
    this.star.update(this.rel.copy(camera).negate());

    const withAtmosphere: BodyState[] = [];
    for (const body of this.bodies) {
      this.rel.subVectors(body.position, camera);
      body.distance = this.rel.length();
      const angle = body.desc.radius / body.distance;
      if (!body.view && angle > PROMOTE_ANGLE) {
        body.view = new PlanetView(body.desc, this.deps);
      } else if (body.view && angle < DEMOTE_ANGLE) {
        body.view.dispose();
        body.view = null;
      }

      if (body.view) {
        this.camLocal.subVectors(camera, body.position);
        body.view.update(this.camLocal, body.sunDir, body.sunColor, true);
        if (body.view.atmosphere) withAtmosphere.push(body);
      }

      // Point marker until the full view can cover the planet (and while its first chunks load).
      const showMarker = !body.view?.terrain.ready;
      body.marker.visible = showMarker;
      if (showMarker) {
        body.marker.position.copy(this.rel);
        body.marker.scale.setScalar(Math.max(body.distance * 0.0022, body.desc.radius * 2));
      }
    }

    const pass = this.engine.atmospherePass;
    pass.beginFrame(this.engine.camera);
    withAtmosphere.sort((a, b) => a.distance - b.distance);
    for (let i = 0; i < Math.min(SLOT_COUNT, withAtmosphere.length); i++) {
      const body = withAtmosphere[i];
      const view = body.view as PlanetView;
      this.camLocal.subVectors(camera, body.position);
      pass.setSlot(i, {
        model: view.atmosphere!,
        cameraLocal: this.camLocal,
        sunDir: body.sunDir,
        sunColor: body.sunColor,
        skyColor: view.shading.skyColor.value,
        clouds: body.desc.clouds,
        planetRadius: body.desc.radius,
        time,
        axis: view.shading.axis.value,
        auroraStrength: body.desc.phenomena.includes('Aurora') ? 2.2 : 0,
      });
    }
  }

  dispose(): void {
    for (const body of this.bodies) {
      body.view?.dispose();
      body.view = null;
      body.marker.removeFromParent();
    }
    for (const material of this.markerMaterials) material.dispose();
    this.bodies.length = 0;
    this.store.dispose();
  }
}
