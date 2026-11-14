// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0 or MIT: see LICENSE.md.
import * as THREE from 'three/webgpu';
import { hash32 } from '@/core/random';

/**
 * Tileable 3D cloud noise (after Schneider's Nubis shape/detail volumes), generated once at start-up.
 *   R  low-frequency value fBm  — weather / billow shape
 *   G  inverted Worley fBm, coarse — cauliflower erosion
 *   B  inverted Worley fBm, fine   — wisps
 */
export function createCloudNoiseTexture(size = 64, seed = 4242): THREE.Data3DTexture {
  const data = new Uint8Array(size * size * size * 4);
  const value = valueFbm(size, seed);
  const worleyA = [worley(size, 4, seed + 1), worley(size, 8, seed + 2)];
  const worleyB = [worley(size, 10, seed + 3), worley(size, 20, seed + 4)];
  for (let i = 0; i < size * size * size; i++) {
    data[i * 4] = Math.round(value[i] * 255);
    data[i * 4 + 1] = Math.round((worleyA[0][i] * 0.65 + worleyA[1][i] * 0.35) * 255);
    data[i * 4 + 2] = Math.round((worleyB[0][i] * 0.6 + worleyB[1][i] * 0.4) * 255);
    data[i * 4 + 3] = 255;
  }
  const texture = new THREE.Data3DTexture(data, size, size, size);
  texture.format = THREE.RGBAFormat;
  texture.type = THREE.UnsignedByteType;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.wrapR = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function lattice(cells: number, seed: number): Float32Array {
  const out = new Float32Array(cells * cells * cells);
  for (let i = 0; i < out.length; i++) out[i] = hash32(seed * 7919 + i) / 4294967296;
  return out;
}

/** Periodic trilinear value noise, 4 octaves, normalised to 0..1. */
function valueFbm(size: number, seed: number): Float32Array {
  const out = new Float32Array(size * size * size);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < 4; o++) {
    const cells = 4 << o;
    const lat = lattice(cells, seed + o);
    const at = (x: number, y: number, z: number) =>
      lat[((z % cells) * cells + (y % cells)) * cells + (x % cells)];
    for (let z = 0; z < size; z++) {
      const fz = (z / size) * cells;
      const z0 = Math.floor(fz);
      const sz = smooth(fz - z0);
      for (let y = 0; y < size; y++) {
        const fy = (y / size) * cells;
        const y0 = Math.floor(fy);
        const sy = smooth(fy - y0);
        for (let x = 0; x < size; x++) {
          const fx = (x / size) * cells;
          const x0 = Math.floor(fx);
          const sx = smooth(fx - x0);
          const a = mix(
            mix(at(x0, y0, z0), at(x0 + 1, y0, z0), sx),
            mix(at(x0, y0 + 1, z0), at(x0 + 1, y0 + 1, z0), sx),
            sy,
          );
          const b = mix(
            mix(at(x0, y0, z0 + 1), at(x0 + 1, y0, z0 + 1), sx),
            mix(at(x0, y0 + 1, z0 + 1), at(x0 + 1, y0 + 1, z0 + 1), sx),
            sy,
          );
          out[(z * size + y) * size + x] += mix(a, b, sz) * amp;
        }
      }
    }
    total += amp;
    amp *= 0.5;
  }
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < out.length; i++) {
    out[i] /= total;
    if (out[i] < min) min = out[i];
    if (out[i] > max) max = out[i];
  }
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - min) / (max - min);
  return out;
}

/** Periodic inverted Worley noise: 1 at feature points, falling to 0 between them. */
function worley(size: number, cells: number, seed: number): Float32Array {
  const px = lattice(cells, seed);
  const py = lattice(cells, seed + 101);
  const pz = lattice(cells, seed + 202);
  const out = new Float32Array(size * size * size);
  const wrap = (v: number) => ((v % cells) + cells) % cells;
  for (let z = 0; z < size; z++) {
    const fz = ((z + 0.5) / size) * cells;
    const cz = Math.floor(fz);
    for (let y = 0; y < size; y++) {
      const fy = ((y + 0.5) / size) * cells;
      const cy = Math.floor(fy);
      for (let x = 0; x < size; x++) {
        const fx = ((x + 0.5) / size) * cells;
        const cx = Math.floor(fx);
        let best = 4;
        for (let dz = -1; dz <= 1; dz++) {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const i = (wrap(cz + dz) * cells + wrap(cy + dy)) * cells + wrap(cx + dx);
              const ex = cx + dx + px[i] - fx;
              const ey = cy + dy + py[i] - fy;
              const ez = cz + dz + pz[i] - fz;
              const d = ex * ex + ey * ey + ez * ez;
              if (d < best) best = d;
            }
          }
        }
        out[(z * size + y) * size + x] = 1 - Math.min(1, Math.sqrt(best));
      }
    }
  }
  return out;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
