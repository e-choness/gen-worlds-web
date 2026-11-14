/**
 * Resolved stars around the observer: every star of the sectors within `SECTOR_RADIUS` is a real,
 * visitable system drawn as a point whose brightness follows luminosity / distance².
 *
 * The set is rebuilt when the observer crosses into another sector. Positions are stored relative
 * to the sector the set was built around, so float32 keeps sub-AU precision over the whole field.
 */

import {
  clamp,
  float,
  instancedBufferAttribute,
  length,
  log2,
  normalize,
  pow,
  smoothstep,
  uniform,
  uv,
  vec4,
} from 'three/tsl';
import * as THREE from 'three/webgpu';
import type { Disposable } from '@/core/disposable';
import { SECTOR_SIZE_LY } from '@/universe/constants';
import type { Galaxy } from '@/universe/galaxy';
import type { StarDesc } from '@/universe/types';

const SECTOR_RADIUS = 4;
/** Distance at which the points are drawn; anything inside the far plane works. */
const DRAW_DISTANCE = 1e12;
const MAX_STARS = 16384;

export class Starfield implements Disposable {
  readonly points: THREE.Sprite;
  /** Stars currently loaded, parallel to the GPU instance order. */
  stars: StarDesc[] = [];
  /** 0..1, see GalaxyBackdrop.visibility. */
  readonly visibility = uniform(1);
  private readonly material: THREE.SpriteNodeMaterial;
  private readonly positions = new THREE.InstancedBufferAttribute(new Float32Array(MAX_STARS * 3), 3);
  private readonly colors = new THREE.InstancedBufferAttribute(new Float32Array(MAX_STARS * 4), 4);
  private readonly observer = uniform(new THREE.Vector3());
  private readonly anchor = new THREE.Vector3();
  private readonly builtSector = new THREE.Vector3(Number.NaN, 0, 0);
  private readonly sector = new THREE.Vector3();

  constructor(private readonly galaxy: Galaxy) {
    const material = new THREE.SpriteNodeMaterial();
    const starPos = instancedBufferAttribute<'vec3'>(this.positions, 'vec3');
    const starCol = instancedBufferAttribute<'vec4'>(this.colors, 'vec4');
    const rel = starPos.sub(this.observer);
    const dist = length(rel);
    const flux = starCol.w.div(dist.mul(dist).add(1e-9));
    // Compress ~12 orders of magnitude of flux into a displayable range (a magnitude scale).
    const intensity = clamp(pow(flux, float(0.3)).mul(0.5), 0.015, 3.5);
    // The star being visited is drawn by StarView: fade its point out on approach.
    const fade = smoothstep(0.0004, 0.004, dist);

    material.positionNode = normalize(rel).mul(DRAW_DISTANCE);
    material.scaleNode = float(DRAW_DISTANCE).mul(float(0.0026).add(log2(intensity.add(1)).mul(0.0022)));
    const r = uv().sub(0.5).length().mul(2);
    const disc = pow(float(1).sub(r).clamp(0, 1), 3);
    material.colorNode = vec4(
      starCol.xyz.mul(intensity).mul(disc).mul(fade).mul(this.visibility).mul(2.2),
      1,
    );
    material.transparent = true;
    material.blending = THREE.AdditiveBlending;
    material.depthWrite = false;
    this.material = material;

    this.points = new THREE.Sprite(material);
    this.points.count = 0;
    this.points.frustumCulled = false;
    this.points.renderOrder = -900;
    this.points.name = 'starfield';
  }

  /** @param positionLy observer position in the galaxy, light-years (float64). */
  update(positionLy: THREE.Vector3): void {
    this.sector.set(
      Math.floor(positionLy.x / SECTOR_SIZE_LY),
      Math.floor(positionLy.y / SECTOR_SIZE_LY),
      Math.floor(positionLy.z / SECTOR_SIZE_LY),
    );
    if (!this.sector.equals(this.builtSector)) this.rebuild();
    this.observer.value.subVectors(positionLy, this.anchor);
  }

  /** Nearest loaded star to a galactic position, or null when none is loaded. */
  nearest(positionLy: THREE.Vector3): { star: StarDesc; distanceLy: number } | null {
    let best: StarDesc | null = null;
    let bestSq = Number.POSITIVE_INFINITY;
    for (const star of this.stars) {
      const dx = star.positionLy[0] - positionLy.x;
      const dy = star.positionLy[1] - positionLy.y;
      const dz = star.positionLy[2] - positionLy.z;
      const sq = dx * dx + dy * dy + dz * dz;
      if (sq < bestSq) {
        bestSq = sq;
        best = star;
      }
    }
    return best ? { star: best, distanceLy: Math.sqrt(bestSq) } : null;
  }

  private rebuild(): void {
    this.builtSector.copy(this.sector);
    this.anchor.copy(this.sector).multiplyScalar(SECTOR_SIZE_LY);
    const pos = this.positions.array as Float32Array;
    const col = this.colors.array as Float32Array;
    const stars: StarDesc[] = [];
    const { x: sx, y: sy, z: sz } = this.sector;
    for (let dz = -SECTOR_RADIUS; dz <= SECTOR_RADIUS; dz++) {
      for (let dy = -SECTOR_RADIUS; dy <= SECTOR_RADIUS; dy++) {
        for (let dx = -SECTOR_RADIUS; dx <= SECTOR_RADIUS; dx++) {
          for (const star of this.galaxy.sectorStars(sx + dx, sy + dy, sz + dz)) {
            if (stars.length >= MAX_STARS) break;
            const i = stars.length;
            pos[i * 3] = star.positionLy[0] - this.anchor.x;
            pos[i * 3 + 1] = star.positionLy[1] - this.anchor.y;
            pos[i * 3 + 2] = star.positionLy[2] - this.anchor.z;
            col[i * 4] = star.color[0];
            col[i * 4 + 1] = star.color[1];
            col[i * 4 + 2] = star.color[2];
            col[i * 4 + 3] = Math.max(star.luminositySolar, 0.0003);
            stars.push(star);
          }
        }
      }
    }
    this.stars = stars;
    this.points.count = stars.length;
    this.positions.needsUpdate = true;
    this.colors.needsUpdate = true;
  }

  dispose(): void {
    this.material.dispose();
    this.points.removeFromParent();
  }
}
