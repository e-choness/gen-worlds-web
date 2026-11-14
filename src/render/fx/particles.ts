// Gen Worlds © 2026 Echo Yin. PolyForm Noncommercial 1.0.0: see LICENSE.md.
/**
 * A pooled CPU particle system drawn as one instanced sprite.
 *
 * Positions are relative to the camera (the scene origin). The camera moves in float64, so every
 * frame the caller passes how far it moved and live particles are shifted by the opposite amount.
 *
 * Blending is premultiplied (ONE, ONE_MINUS_SRC_ALPHA): a particle with alpha 0 adds light (sparks,
 * exhaust), one with alpha > 0 also occludes (dust, snow), so a single draw call covers both.
 * Colours are scene-linear radiance: emitters pre-multiply by the local light where it matters.
 */
import { float, instancedBufferAttribute, uv, vec4 } from 'three/tsl';
import * as THREE from 'three/webgpu';
import type { Disposable } from '@/core/disposable';

export const MAX_PARTICLES = 4096;

export interface ParticleSpawn {
  /** Position relative to the camera, metres. */
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Seconds to live. */
  life: number;
  /** Diameter at birth and at death, metres. */
  size: number;
  endSize: number;
  r: number;
  g: number;
  b: number;
  /** 0 = purely additive. */
  alpha: number;
  /** Velocity damping per second (air resistance). */
  drag: number;
  /** Multiplier on the gravity vector passed to `update` (negative rises). */
  gravity: number;
}

export class ParticleSystem implements Disposable {
  readonly sprite: THREE.Sprite;
  private readonly material: THREE.SpriteNodeMaterial;
  private readonly positions = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3);
  private readonly colors = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PARTICLES * 4), 4);
  private readonly sizes = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PARTICLES), 1);
  // Simulation state, structure-of-arrays, indexed by slot.
  private readonly pos = new Float32Array(MAX_PARTICLES * 3);
  private readonly vel = new Float32Array(MAX_PARTICLES * 3);
  private readonly color = new Float32Array(MAX_PARTICLES * 4);
  private readonly age = new Float32Array(MAX_PARTICLES);
  private readonly life = new Float32Array(MAX_PARTICLES);
  private readonly size0 = new Float32Array(MAX_PARTICLES);
  private readonly size1 = new Float32Array(MAX_PARTICLES);
  private readonly drag = new Float32Array(MAX_PARTICLES);
  private readonly gravity = new Float32Array(MAX_PARTICLES);
  /** Next slot to write; the pool is a ring, so the oldest particle is recycled when full. */
  private cursor = 0;
  alive = 0;

  constructor() {
    this.positions.setUsage(THREE.DynamicDrawUsage);
    this.colors.setUsage(THREE.DynamicDrawUsage);
    this.sizes.setUsage(THREE.DynamicDrawUsage);
    const material = new THREE.SpriteNodeMaterial();
    const color = instancedBufferAttribute<'vec4'>(this.colors, 'vec4');
    material.positionNode = instancedBufferAttribute<'vec3'>(this.positions, 'vec3');
    material.scaleNode = instancedBufferAttribute<'float'>(this.sizes, 'float');
    const r = uv().sub(0.5).length().mul(2);
    const soft = float(1).sub(r).clamp(0, 1).pow(1.5);
    material.colorNode = vec4(color.xyz.mul(soft), color.w.mul(soft));
    material.transparent = true;
    material.depthWrite = false;
    material.blending = THREE.CustomBlending;
    material.blendEquation = THREE.AddEquation;
    material.blendSrc = THREE.OneFactor;
    material.blendDst = THREE.OneMinusSrcAlphaFactor;
    material.blendSrcAlpha = THREE.OneFactor;
    material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    this.material = material;

    this.sprite = new THREE.Sprite(material);
    this.sprite.count = 0;
    this.sprite.frustumCulled = false;
    this.sprite.renderOrder = 50;
    this.sprite.name = 'particles';
  }

  spawn(p: ParticleSpawn): void {
    const i = this.cursor;
    this.cursor = (i + 1) % MAX_PARTICLES;
    this.pos[i * 3] = p.x;
    this.pos[i * 3 + 1] = p.y;
    this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = p.vx;
    this.vel[i * 3 + 1] = p.vy;
    this.vel[i * 3 + 2] = p.vz;
    this.color[i * 4] = p.r;
    this.color[i * 4 + 1] = p.g;
    this.color[i * 4 + 2] = p.b;
    this.color[i * 4 + 3] = p.alpha;
    this.age[i] = 0;
    this.life[i] = p.life;
    this.size0[i] = p.size;
    this.size1[i] = p.endSize;
    this.drag[i] = p.drag;
    this.gravity[i] = p.gravity;
  }

  /**
   * @param cameraDelta how far the camera moved this frame (system space, metres).
   * @param gravity local gravity vector, m/s² (zero in open space).
   */
  update(dt: number, cameraDelta: THREE.Vector3, gravity: THREE.Vector3): void {
    const out = this.positions.array as Float32Array;
    const outColor = this.colors.array as Float32Array;
    const outSize = this.sizes.array as Float32Array;
    const { pos, vel, color, age, life } = this;
    let n = 0;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (life[i] <= 0) continue;
      age[i] += dt;
      const t = age[i] / life[i];
      if (t >= 1) {
        life[i] = 0;
        continue;
      }
      const a = i * 3;
      const g = this.gravity[i];
      const damp = Math.exp(-this.drag[i] * dt);
      vel[a] = (vel[a] + gravity.x * g * dt) * damp;
      vel[a + 1] = (vel[a + 1] + gravity.y * g * dt) * damp;
      vel[a + 2] = (vel[a + 2] + gravity.z * g * dt) * damp;
      pos[a] += vel[a] * dt - cameraDelta.x;
      pos[a + 1] += vel[a + 1] * dt - cameraDelta.y;
      pos[a + 2] += vel[a + 2] * dt - cameraDelta.z;
      // Left far behind (fast travel, system hand-over): retire rather than draw a huge coordinate.
      if (Math.abs(pos[a]) + Math.abs(pos[a + 1]) + Math.abs(pos[a + 2]) > 4000) {
        life[i] = 0;
        continue;
      }
      // Quick fade in, long fade out.
      const fade = Math.min(1, t * 8) * (1 - t) ** 1.2;
      out[n * 3] = pos[a];
      out[n * 3 + 1] = pos[a + 1];
      out[n * 3 + 2] = pos[a + 2];
      outColor[n * 4] = color[i * 4] * fade;
      outColor[n * 4 + 1] = color[i * 4 + 1] * fade;
      outColor[n * 4 + 2] = color[i * 4 + 2] * fade;
      outColor[n * 4 + 3] = color[i * 4 + 3] * fade;
      outSize[n] = this.size0[i] + (this.size1[i] - this.size0[i]) * t;
      n++;
    }
    this.alive = n;
    this.sprite.count = n;
    this.sprite.visible = n > 0;
    if (n > 0) {
      this.positions.needsUpdate = true;
      this.colors.needsUpdate = true;
      this.sizes.needsUpdate = true;
    }
  }

  clear(): void {
    this.life.fill(0);
    this.alive = 0;
    this.sprite.count = 0;
    this.sprite.visible = false;
  }

  dispose(): void {
    this.material.dispose();
    this.sprite.removeFromParent();
  }
}
