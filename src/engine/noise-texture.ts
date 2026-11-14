// Gen Worlds © 2026 Echo Yin. PolyForm Noncommercial 1.0.0: see LICENSE.md.
import * as THREE from 'three/webgpu';
import { hash32 } from '@/core/random';

/**
 * Tileable detail texture generated once at startup.
 *   RG  tangent-space normal (xy) of a periodic fBm height field
 *   B   the height itself
 *   A   an independent periodic fBm, for breaking up blends
 * Used triplanar at several world scales for micro relief and albedo variation.
 */
export function createDetailTexture(size = 512, seed = 1337): THREE.DataTexture {
  const height = periodicFbm(size, seed, 4, 6);
  const extra = periodicFbm(size, seed ^ 0x9e3779b9, 8, 5);
  const data = new Uint8Array(size * size * 4);
  const strength = size / 48;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const xl = height[y * size + ((x + size - 1) % size)];
      const xr = height[y * size + ((x + 1) % size)];
      const yd = height[((y + size - 1) % size) * size + x];
      const yu = height[((y + 1) % size) * size + x];
      let nx = (xl - xr) * strength;
      let ny = (yd - yu) * strength;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + 1);
      nx *= inv;
      ny *= inv;
      data[i * 4] = Math.round((nx * 0.5 + 0.5) * 255);
      data[i * 4 + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      data[i * 4 + 2] = Math.round(height[i] * 255);
      data[i * 4 + 3] = Math.round(extra[i] * 255);
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 8;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** Periodic value-noise fBm normalised to 0..1. */
function periodicFbm(size: number, seed: number, baseCells: number, octaves: number): Float32Array {
  const out = new Float32Array(size * size);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const cells = baseCells << o;
    const lattice = new Float32Array(cells * cells);
    for (let i = 0; i < lattice.length; i++) lattice[i] = hash32(seed + o * 7919 + i) / 4294967296;
    for (let y = 0; y < size; y++) {
      const fy = (y / size) * cells;
      const y0 = Math.floor(fy);
      const ty = fy - y0;
      const sy = ty * ty * (3 - 2 * ty);
      const ya = (y0 % cells) * cells;
      const yb = ((y0 + 1) % cells) * cells;
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * cells;
        const x0 = Math.floor(fx);
        const tx = fx - x0;
        const sx = tx * tx * (3 - 2 * tx);
        const xa = x0 % cells;
        const xb = (x0 + 1) % cells;
        const top = lattice[ya + xa] + (lattice[ya + xb] - lattice[ya + xa]) * sx;
        const bottom = lattice[yb + xa] + (lattice[yb + xb] - lattice[yb + xa]) * sx;
        out[y * size + x] += (top + (bottom - top) * sy) * amp;
      }
    }
    total += amp;
    amp *= 0.55;
  }
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < out.length; i++) {
    out[i] /= total;
    if (out[i] < min) min = out[i];
    if (out[i] > max) max = out[i];
  }
  const range = 1 / (max - min);
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - min) * range;
  return out;
}
