// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
/**
 * The system's star: a photosphere sphere with limb darkening and convection granulation, plus a
 * camera-facing corona/glare sprite. Emits HDR radiance; bloom does the rest.
 */

import {
  cameraPosition,
  dot,
  float,
  mx_fractal_noise_float,
  normalize,
  normalWorld,
  positionLocal,
  positionWorld,
  pow,
  smoothstep,
  time,
  uniform,
  uv,
  vec3,
  vec4,
} from 'three/tsl';
import * as THREE from 'three/webgpu';
import type { Disposable } from '@/core/disposable';
import type { StarDesc } from '@/universe/types';

export class StarView implements Disposable {
  readonly group = new THREE.Group();
  private readonly sphere: THREE.Mesh;
  private readonly glare: THREE.Sprite;
  private readonly glareScale = uniform(1);

  constructor(readonly star: StarDesc) {
    const tint = vec3(...star.color);
    const compact = star.class === 'BH' || star.class === 'NS';

    const surface = new THREE.MeshBasicNodeMaterial();
    const dir = normalize(positionLocal);
    const V = normalize(cameraPosition.sub(positionWorld));
    const mu = dot(normalize(normalWorld), V).clamp(0, 1);
    // Limb darkening (quadratic law) and slowly boiling granulation.
    const limb = float(1)
      .sub(float(0.55).mul(float(1).sub(mu)))
      .sub(float(0.25).mul(float(1).sub(mu).pow(2)));
    const cells = mx_fractal_noise_float(dir.mul(28).add(vec3(0, time.mul(0.02), 0)), 4, 2.2, 0.55);
    const spots = smoothstep(0.35, 0.75, mx_fractal_noise_float(dir.mul(3.5).add(11), 3, 2, 0.5));
    const radiance = tint
      .mul(limb)
      .mul(cells.mul(0.18).add(1))
      .mul(float(1).sub(spots.mul(0.55)));
    surface.colorNode = vec4(radiance.mul(star.class === 'BH' ? 0 : 60), 1);
    this.sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 48), surface);
    this.sphere.scale.setScalar(star.radius);
    this.group.add(this.sphere);

    const glareMaterial = new THREE.SpriteNodeMaterial();
    const c = uv().sub(0.5).mul(2);
    const r = c.length();
    const core = pow(float(1).sub(r).clamp(0, 1), 6).mul(9);
    const halo = float(0.012)
      .div(r.mul(r).add(0.004))
      .mul(smoothstep(1, 0.2, r));
    glareMaterial.colorNode = vec4(tint.mul(core.add(halo)).mul(compact ? 0.4 : 1), 1);
    glareMaterial.transparent = true;
    glareMaterial.blending = THREE.AdditiveBlending;
    glareMaterial.depthWrite = false;
    this.glare = new THREE.Sprite(glareMaterial);
    this.group.add(this.glare);
    this.group.name = `star:${star.name}`;
  }

  /** @param relative star position relative to the camera, float64. */
  update(relative: THREE.Vector3): void {
    this.group.position.copy(relative);
    const distance = relative.length();
    // The glare keeps a minimum apparent size so the star stays a bright point from far away.
    const size = Math.max(this.star.radius * 9, distance * 0.06);
    this.glare.scale.setScalar(size);
    this.glareScale.value = size;
  }

  dispose(): void {
    this.sphere.geometry.dispose();
    (this.sphere.material as THREE.Material).dispose();
    this.glare.material.dispose();
    this.group.removeFromParent();
  }
}
