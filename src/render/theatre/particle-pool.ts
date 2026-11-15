// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
/**
 * A fixed pool of soft blobs for exhaust, smoke and dust in the mission theatre: one instanced mesh,
 * all state in typed arrays allocated once, so emitting and updating allocate nothing per frame.
 * Positions are in the theatre's scene units (metres, a few hundred at most: float32 is exact enough).
 */
import { float, normalView } from 'three/tsl';
import * as THREE from 'three/webgpu';
import type { Disposable } from '@/core/disposable';

export interface ParticleLook {
  /** Colour at birth and at death (linear RGB hex); the blob fades from one to the other. */
  from: number;
  to: number;
  /** Additive blobs glow (flame); normal ones cover what is behind them (smoke, dust). */
  additive: boolean;
  opacity: number;
  /** Size at death relative to size at birth. */
  growth: number;
  /** Fraction of velocity kept after one second. */
  drag: number;
  /** Vertical acceleration, m/s² (negative falls). */
  gravity: number;
}

export class ParticlePool implements Disposable {
  readonly mesh: THREE.InstancedMesh;
  private readonly position: Float32Array;
  private readonly velocity: Float32Array;
  /** Age and lifetime, seconds; lifetime 0 marks a free slot. */
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly size: Float32Array;
  private readonly from = new THREE.Color();
  private readonly to = new THREE.Color();
  private readonly colour = new THREE.Color();
  private readonly matrix = new THREE.Matrix4();
  private cursor = 0;

  constructor(
    private readonly capacity: number,
    private readonly look: ParticleLook,
  ) {
    this.position = new Float32Array(capacity * 3);
    this.velocity = new Float32Array(capacity * 3);
    this.age = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.from.setHex(look.from);
    this.to.setHex(look.to);
    const material = new THREE.MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: false,
      blending: look.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    // Each blob is a ball that is densest where it faces the camera and thins to nothing at its
    // edge, so overlapping blobs read as one soft cloud instead of a pile of spheres.
    material.opacityNode = float(look.opacity).mul(normalView.z.abs().pow(2.2));
    this.mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 14, 10), material, capacity);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.matrix.makeScale(0, 0, 0);
    for (let index = 0; index < capacity; index++) {
      this.mesh.setMatrixAt(index, this.matrix);
      this.mesh.setColorAt(index, this.from);
    }
  }

  /** Starts one blob; the oldest slot is reused when the pool is full. */
  emit(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    lifeSeconds: number,
    sizeM: number,
  ): void {
    const index = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    this.position[index * 3] = x;
    this.position[index * 3 + 1] = y;
    this.position[index * 3 + 2] = z;
    this.velocity[index * 3] = vx;
    this.velocity[index * 3 + 1] = vy;
    this.velocity[index * 3 + 2] = vz;
    this.age[index] = 0;
    this.life[index] = lifeSeconds;
    this.size[index] = sizeM;
  }

  /** Removes every blob at once (a change of scene). */
  clear(): void {
    this.life.fill(0);
  }

  /**
   * Moves and fades the blobs. `floorY` is where smoke stops falling and spreads sideways instead
   * (pass -Infinity where there is no ground).
   */
  update(dt: number, floorY: number): void {
    const { position, velocity, age, life, size, look, matrix, colour } = this;
    const keep = look.drag ** dt;
    const elements = matrix.elements;
    for (let index = 0; index < this.capacity; index++) {
      const lifetime = life[index];
      let scale = 0;
      if (lifetime > 0) {
        const t = age[index] + dt;
        age[index] = t;
        if (t >= lifetime) life[index] = 0;
        else {
          const o = index * 3;
          velocity[o] *= keep;
          velocity[o + 1] = velocity[o + 1] * keep + look.gravity * dt;
          velocity[o + 2] *= keep;
          position[o] += velocity[o] * dt;
          position[o + 1] += velocity[o + 1] * dt;
          position[o + 2] += velocity[o + 2] * dt;
          if (position[o + 1] < floorY) {
            position[o + 1] = floorY;
            velocity[o + 1] = 0;
          }
          const k = t / lifetime;
          // Swell quickly, then shrink to nothing over the last third, so blobs never pop out.
          scale = size[index] * (1 + (look.growth - 1) * k) * Math.min(1, (1 - k) * 3);
          elements[12] = position[o];
          elements[13] = position[o + 1];
          elements[14] = position[o + 2];
          colour.copy(this.from).lerp(this.to, k);
          this.mesh.setColorAt(index, colour);
        }
      }
      elements[0] = scale;
      elements[5] = scale;
      elements[10] = scale;
      if (scale === 0) {
        elements[12] = 0;
        elements[13] = 0;
        elements[14] = 0;
      }
      this.mesh.setMatrixAt(index, matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}
