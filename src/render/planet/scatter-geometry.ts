// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0 or MIT: see LICENSE.md.
/**
 * Procedural meshes for surface scatter: boulders, rock spires, crystal clusters and giant fungi.
 * All are unit-sized (about one metre) with +Y up and their base at y = 0 (boulders are centred),
 * carry vertex colours for shading variation, and are deterministic in `seed`.
 */
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import * as THREE from 'three/webgpu';
import { Noise3 } from '@/core/noise';
import { Rng } from '@/core/random';

/** Writes a per-vertex grey level (multiplied into the material colour). */
function shade(geometry: THREE.BufferGeometry, fn: (p: THREE.Vector3) => number): void {
  const position = geometry.getAttribute('position');
  const colors = new Float32Array(position.count * 3);
  const p = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    const v = fn(p.fromBufferAttribute(position, i));
    colors[i * 3] = v;
    colors[i * 3 + 1] = v;
    colors[i * 3 + 2] = v;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

/** A closed, lumpy boulder: a welded icosphere pushed around by two octaves of noise. */
export function makeRockGeometry(seed: number): THREE.BufferGeometry {
  const noise = new Noise3(seed);
  const rng = new Rng(seed);
  const base = new THREE.IcosahedronGeometry(1, 3);
  base.deleteAttribute('uv');
  base.deleteAttribute('normal');
  const geometry = mergeVertices(base, 1e-4);
  base.dispose();
  const position = geometry.getAttribute('position');
  const squash = new THREE.Vector3(rng.range(0.8, 1.25), rng.range(0.55, 0.85), rng.range(0.8, 1.2));
  const p = new THREE.Vector3();
  const small: number[] = [];
  for (let i = 0; i < position.count; i++) {
    p.fromBufferAttribute(position, i);
    const big = noise.eval(p.x * 0.9, p.y * 0.9, p.z * 0.9);
    const fine = noise.eval(p.x * 3.1 + 7, p.y * 3.1, p.z * 3.1);
    small.push(fine);
    // Flattened facets: clamp the large lobe so parts of the surface read as fracture planes.
    const d = 1 + Math.max(-0.22, Math.min(0.18, big * 0.4)) + fine * 0.06;
    p.multiplyScalar(d).multiply(squash);
    position.setXYZ(i, p.x, p.y, p.z);
  }
  let index = 0;
  shade(geometry, () => 0.75 + 0.35 * (small[index++] * 0.5 + 0.5));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/** A weathered rock column (hoodoo / lava chimney): stacked strata with a harder cap. About 4 units tall. */
export function makeSpireGeometry(seed: number): THREE.BufferGeometry {
  const noise = new Noise3(seed);
  const rng = new Rng(seed);
  const height = rng.range(3.2, 5);
  const base = new THREE.CylinderGeometry(0.34, 0.85, height, 18, 26, false);
  base.deleteAttribute('uv');
  base.deleteAttribute('normal');
  base.translate(0, height / 2, 0);
  const geometry = mergeVertices(base, 1e-4);
  base.dispose();
  const position = geometry.getAttribute('position');
  const capAt = rng.range(0.72, 0.86);
  const lean = rng.range(-0.12, 0.12);
  const p = new THREE.Vector3();
  for (let i = 0; i < position.count; i++) {
    p.fromBufferAttribute(position, i);
    const t = p.y / height;
    const radial = Math.hypot(p.x, p.z);
    if (radial > 1e-4) {
      // Differential erosion: soft layers recede, the caprock overhangs.
      const strata = 0.88 + 0.13 * Math.sin(t * 19 + seed) + 0.06 * Math.sin(t * 47);
      const cap = t > capAt ? 1.55 - (t - capAt) * 2.2 : 1;
      const lump = 1 + 0.22 * noise.eval(p.x * 1.3, p.y * 0.8, p.z * 1.3);
      const k = strata * cap * lump;
      p.x *= k;
      p.z *= k;
    }
    p.x += lean * p.y;
    position.setXYZ(i, p.x, p.y, p.z);
  }
  shade(geometry, (v) => 0.7 + 0.3 * (0.5 + 0.5 * Math.sin((v.y / height) * 31 + seed * 0.1)));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/** A cluster of hexagonal crystals fanning out of a common base. About 1.5 units tall. */
export function makeCrystalGeometry(seed: number): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const parts: THREE.BufferGeometry[] = [];
  const count = rng.int(4, 8);
  for (let i = 0; i < count; i++) {
    const main = i === 0;
    const length = main ? rng.range(1.3, 1.8) : rng.range(0.45, 1.1);
    const radius = length * rng.range(0.1, 0.16);
    const shaft = new THREE.CylinderGeometry(radius * 0.92, radius, length, 6, 1, false);
    shaft.translate(0, length / 2, 0);
    const tip = new THREE.ConeGeometry(radius * 0.92, radius * 2.2, 6, 1, false);
    tip.translate(0, length + radius * 1.1, 0);
    const crystal = mergeGeometries([shaft, tip]);
    shaft.dispose();
    tip.dispose();
    const tilt = main ? rng.range(0, 0.15) : rng.range(0.35, 0.95);
    crystal.rotateZ(tilt);
    crystal.rotateY(rng.range(0, Math.PI * 2));
    crystal.translate(rng.range(-0.12, 0.12), -0.05, rng.range(-0.12, 0.12));
    parts.push(crystal);
  }
  const merged = mergeGeometries(parts);
  for (const part of parts) part.dispose();
  merged.deleteAttribute('uv');
  // Faceted: each face keeps its own normal.
  const geometry = merged.toNonIndexed();
  merged.dispose();
  geometry.computeVertexNormals();
  // Brighter toward the tips, as if lit from within.
  shade(geometry, (v) => 0.55 + 0.45 * Math.min(1, Math.max(0, v.y / 1.4)));
  geometry.computeBoundingSphere();
  return geometry;
}

/** A giant fungus: tapering stalk under a domed cap. About 1 unit tall; the cap is brighter than the stalk. */
export function makeMushroomGeometry(seed: number): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const capRadius = rng.range(0.42, 0.7);
  const capHeight = rng.range(0.18, 0.4);
  const stalk = rng.range(0.05, 0.085);
  const flat = rng.chance(0.4);
  // Profile revolved around Y: up the stalk, out under the cap, over the dome.
  const profile: THREE.Vector2[] = [
    new THREE.Vector2(stalk * 1.9, 0),
    new THREE.Vector2(stalk * 1.2, 0.12),
    new THREE.Vector2(stalk, 0.55),
    new THREE.Vector2(stalk * 1.1, 0.76),
    new THREE.Vector2(capRadius * 0.55, 0.74),
    new THREE.Vector2(capRadius, flat ? 0.78 : 0.72),
  ];
  for (let i = 1; i <= 7; i++) {
    const a = (i / 7) * (Math.PI / 2);
    profile.push(
      new THREE.Vector2(capRadius * Math.cos(a), 0.78 + capHeight * Math.sin(a) ** (flat ? 0.6 : 1)),
    );
  }
  const geometry = new THREE.LatheGeometry(profile, 18);
  geometry.deleteAttribute('uv');
  const bend = rng.range(-0.18, 0.18);
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i);
    position.setX(i, position.getX(i) + bend * y * y);
  }
  // Stalk and gills dim, cap at full colour with darker speckle rings.
  shade(geometry, (v) => {
    const radial = Math.hypot(v.x - bend * v.y * v.y, v.z);
    if (v.y < 0.77) return radial > stalk * 1.5 ? 0.22 : 0.42;
    return 0.85 + 0.15 * Math.sin(radial * 26 + seed);
  });
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
