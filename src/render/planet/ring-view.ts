// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
/**
 * Planetary rings: a flat annulus in the planet's equatorial plane with a procedural radial
 * structure (ringlets, gaps), lit by the star, shadowed by the planet, and brighter in forward
 * scattering when seen from the unlit side.
 */

import {
  cameraPosition,
  clamp,
  dot,
  float,
  max,
  mix,
  mx_noise_float,
  normalize,
  positionLocal,
  positionWorld,
  pow,
  smoothstep,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import * as THREE from 'three/webgpu';
import type { Disposable } from '@/core/disposable';
import type { FloatNode } from '@/engine/tsl';
import type { BodyDesc, RingDesc } from '@/universe/types';
import type { PlanetShading } from './planet-materials';

/**
 * Optical depth profile across the ring, `x` = 0 at the inner edge, 1 at the outer edge.
 * Shared by the ring material and by the shadow the rings cast on the planet.
 */
export function ringProfile(x: FloatNode, ring: RingDesc): FloatNode {
  const seed = (ring.seed % 1000) / 10;
  const broad = mx_noise_float(vec2(x.mul(9), seed))
    .mul(0.5)
    .add(0.5);
  const ringlets = mx_noise_float(vec2(x.mul(70), seed + 3.7))
    .mul(0.5)
    .add(0.5);
  const fine = mx_noise_float(vec2(x.mul(420), seed + 9.1))
    .mul(0.5)
    .add(0.5);
  // One wide division, as shepherd moons carve.
  const gapAt = 0.35 + ((ring.seed >>> 8) % 100) / 250;
  const gap = smoothstep(0.012, 0.03, x.sub(gapAt).abs());
  const edges = smoothstep(0, 0.04, x).mul(smoothstep(1, 0.93, x));
  return clamp(broad.mul(0.75).add(ringlets.mul(0.45)).add(fine.mul(0.2)).sub(0.25), 0, 1)
    .mul(gap)
    .mul(edges) as FloatNode;
}

export class RingView implements Disposable {
  readonly mesh: THREE.Mesh;
  private readonly center = uniform(new THREE.Vector3());

  constructor(body: BodyDesc, shading: PlanetShading) {
    const ring = body.rings as RingDesc;
    const geometry = new THREE.RingGeometry(ring.innerRadius, ring.outerRadius, 384, 1);
    const material = new THREE.MeshBasicNodeMaterial();
    material.name = `rings:${body.name}`;

    const radius = positionLocal.xy.length();
    const x = radius.sub(ring.innerRadius).div(ring.outerRadius - ring.innerRadius);
    const density = ringProfile(x, ring);

    // Planet shadow: does the ray from this point toward the star hit the planet?
    const P = positionWorld.sub(this.center);
    const L = shading.sunDir;
    const b = dot(P, L);
    const disc = b.mul(b).sub(dot(P, P).sub(body.radius * body.radius));
    const shadow = float(1).sub(
      smoothstep(0, body.radius * body.radius * 0.02, disc).mul(b.lessThan(0).select(1, 0)),
    );

    // Lit side: diffuse reflection. Unlit side: light filtering through, strongest where the ring is thin.
    const V = normalize(cameraPosition.sub(positionWorld));
    const axis = shading.axis;
    const sameSide = smoothstep(-0.02, 0.02, dot(V, axis).mul(dot(L, axis)));
    const elevation = dot(L, axis).abs();
    const reflected = density
      .mul(0.55)
      .add(0.45)
      .mul(smoothstep(0, 0.25, elevation).mul(0.75).add(0.25));
    const transmitted = density.mul(float(1).sub(density)).mul(2.2).add(0.05);
    const forward = pow(max(dot(V.negate(), L), 0), 6).mul(0.8);
    const tint = vec3(...ring.color).mul(
      mx_noise_float(vec2(x.mul(22), 1.3))
        .mul(0.12)
        .add(1),
    );
    const lit = tint
      .mul(mix(transmitted.add(forward), reflected, sameSide))
      .mul(shading.sunColor)
      .mul(shadow);

    material.colorNode = vec4(lit, density.mul(ring.opacity));
    material.transparent = true;
    material.side = THREE.DoubleSide;
    material.depthWrite = false;

    this.mesh = new THREE.Mesh(geometry, material);
    // RingGeometry lies in the XY plane: rotate its normal (+Z) onto the planet's spin axis.
    this.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), shading.axis.value);
    this.mesh.name = material.name;
  }

  /** @param relative planet centre relative to the camera. */
  update(relative: THREE.Vector3): void {
    this.mesh.position.copy(relative);
    this.center.value.copy(relative);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.removeFromParent();
  }
}
