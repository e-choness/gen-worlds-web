// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0 or MIT: see LICENSE.md.
/**
 * Seeded 3D simplex noise with analytic derivatives, evaluated in float64.
 *
 * Runs identically on the main thread (collision / altitude queries) and in terrain workers (mesh
 * generation), so the terrain the player touches is exactly the terrain that is drawn.
 */
import { Rng } from './random';

const F3 = 1 / 3;
const G3 = 1 / 6;
// 12 edge-midpoint gradients, repeated to 16 so the index is a cheap mask.
const GRAD = new Float64Array([
  1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0, 1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1, 0, 1, 1, 0, -1, 1, 0, 1, -1,
  0, -1, -1, 1, 1, 0, 0, -1, 1, -1, 1, 0, 0, -1, -1,
]);
/** Normalises the r²=0.5 kernel to roughly [-1, 1]. */
const SCALE = 76;

/** Scratch output for `evalD`: value in [0], gradient in [1..3]. */
export type NoiseSample = Float64Array;

export class Noise3 {
  private readonly perm = new Uint8Array(512);

  constructor(seed: number) {
    const rng = new Rng(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = rng.int(0, i);
      const t = p[i];
      p[i] = p[j];
      p[j] = t;
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  /** Noise value in roughly [-1, 1]. */
  eval(x: number, y: number, z: number): number {
    const perm = this.perm;
    const s = (x + y + z) * F3;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const k = Math.floor(z + s);
    const t = (i + j + k) * G3;
    const x0 = x - (i - t);
    const y0 = y - (j - t);
    const z0 = z - (k - t);

    let i1: number, j1: number, k1: number, i2: number, j2: number, k2: number;
    if (x0 >= y0) {
      if (y0 >= z0) {
        i1 = 1;
        j1 = 0;
        k1 = 0;
        i2 = 1;
        j2 = 1;
        k2 = 0;
      } else if (x0 >= z0) {
        i1 = 1;
        j1 = 0;
        k1 = 0;
        i2 = 1;
        j2 = 0;
        k2 = 1;
      } else {
        i1 = 0;
        j1 = 0;
        k1 = 1;
        i2 = 1;
        j2 = 0;
        k2 = 1;
      }
    } else if (y0 < z0) {
      i1 = 0;
      j1 = 0;
      k1 = 1;
      i2 = 0;
      j2 = 1;
      k2 = 1;
    } else if (x0 < z0) {
      i1 = 0;
      j1 = 1;
      k1 = 0;
      i2 = 0;
      j2 = 1;
      k2 = 1;
    } else {
      i1 = 0;
      j1 = 1;
      k1 = 0;
      i2 = 1;
      j2 = 1;
      k2 = 0;
    }

    const x1 = x0 - i1 + G3,
      y1 = y0 - j1 + G3,
      z1 = z0 - k1 + G3;
    const x2 = x0 - i2 + 2 * G3,
      y2 = y0 - j2 + 2 * G3,
      z2 = z0 - k2 + 2 * G3;
    const x3 = x0 - 1 + 3 * G3,
      y3 = y0 - 1 + 3 * G3,
      z3 = z0 - 1 + 3 * G3;
    const ii = i & 255,
      jj = j & 255,
      kk = k & 255;

    let n = 0;
    let tt = 0.5 - x0 * x0 - y0 * y0 - z0 * z0;
    if (tt > 0) {
      const g = (perm[ii + perm[jj + perm[kk]]] & 15) * 3;
      tt *= tt;
      n += tt * tt * (GRAD[g] * x0 + GRAD[g + 1] * y0 + GRAD[g + 2] * z0);
    }
    tt = 0.5 - x1 * x1 - y1 * y1 - z1 * z1;
    if (tt > 0) {
      const g = (perm[ii + i1 + perm[jj + j1 + perm[kk + k1]]] & 15) * 3;
      tt *= tt;
      n += tt * tt * (GRAD[g] * x1 + GRAD[g + 1] * y1 + GRAD[g + 2] * z1);
    }
    tt = 0.5 - x2 * x2 - y2 * y2 - z2 * z2;
    if (tt > 0) {
      const g = (perm[ii + i2 + perm[jj + j2 + perm[kk + k2]]] & 15) * 3;
      tt *= tt;
      n += tt * tt * (GRAD[g] * x2 + GRAD[g + 1] * y2 + GRAD[g + 2] * z2);
    }
    tt = 0.5 - x3 * x3 - y3 * y3 - z3 * z3;
    if (tt > 0) {
      const g = (perm[ii + 1 + perm[jj + 1 + perm[kk + 1]]] & 15) * 3;
      tt *= tt;
      n += tt * tt * (GRAD[g] * x3 + GRAD[g + 1] * y3 + GRAD[g + 2] * z3);
    }
    return SCALE * n;
  }

  /** Noise value and gradient. Writes [value, d/dx, d/dy, d/dz] into `out`. */
  evalD(x: number, y: number, z: number, out: NoiseSample): void {
    const perm = this.perm;
    const s = (x + y + z) * F3;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const k = Math.floor(z + s);
    const t = (i + j + k) * G3;
    const x0 = x - (i - t);
    const y0 = y - (j - t);
    const z0 = z - (k - t);

    let i1: number, j1: number, k1: number, i2: number, j2: number, k2: number;
    if (x0 >= y0) {
      if (y0 >= z0) {
        i1 = 1;
        j1 = 0;
        k1 = 0;
        i2 = 1;
        j2 = 1;
        k2 = 0;
      } else if (x0 >= z0) {
        i1 = 1;
        j1 = 0;
        k1 = 0;
        i2 = 1;
        j2 = 0;
        k2 = 1;
      } else {
        i1 = 0;
        j1 = 0;
        k1 = 1;
        i2 = 1;
        j2 = 0;
        k2 = 1;
      }
    } else if (y0 < z0) {
      i1 = 0;
      j1 = 0;
      k1 = 1;
      i2 = 0;
      j2 = 1;
      k2 = 1;
    } else if (x0 < z0) {
      i1 = 0;
      j1 = 1;
      k1 = 0;
      i2 = 0;
      j2 = 1;
      k2 = 1;
    } else {
      i1 = 0;
      j1 = 1;
      k1 = 0;
      i2 = 1;
      j2 = 1;
      k2 = 0;
    }

    const ii = i & 255,
      jj = j & 255,
      kk = k & 255;
    let n = 0,
      dx = 0,
      dy = 0,
      dz = 0;

    for (let c = 0; c < 4; c++) {
      let cx: number, cy: number, cz: number, g: number;
      if (c === 0) {
        cx = x0;
        cy = y0;
        cz = z0;
        g = perm[ii + perm[jj + perm[kk]]];
      } else if (c === 1) {
        cx = x0 - i1 + G3;
        cy = y0 - j1 + G3;
        cz = z0 - k1 + G3;
        g = perm[ii + i1 + perm[jj + j1 + perm[kk + k1]]];
      } else if (c === 2) {
        cx = x0 - i2 + 2 * G3;
        cy = y0 - j2 + 2 * G3;
        cz = z0 - k2 + 2 * G3;
        g = perm[ii + i2 + perm[jj + j2 + perm[kk + k2]]];
      } else {
        cx = x0 - 1 + 3 * G3;
        cy = y0 - 1 + 3 * G3;
        cz = z0 - 1 + 3 * G3;
        g = perm[ii + 1 + perm[jj + 1 + perm[kk + 1]]];
      }
      const tt = 0.5 - cx * cx - cy * cy - cz * cz;
      if (tt <= 0) continue;
      g = (g & 15) * 3;
      const gx = GRAD[g],
        gy = GRAD[g + 1],
        gz = GRAD[g + 2];
      const gd = gx * cx + gy * cy + gz * cz;
      const t2 = tt * tt;
      const t4 = t2 * t2;
      const k8 = -8 * t2 * tt * gd;
      n += t4 * gd;
      dx += k8 * cx + t4 * gx;
      dy += k8 * cy + t4 * gy;
      dz += k8 * cz + t4 * gz;
    }
    out[0] = SCALE * n;
    out[1] = SCALE * dx;
    out[2] = SCALE * dy;
    out[3] = SCALE * dz;
  }
}

/** 3D cellular hash in [0,1) for crater / feature placement. Stable across threads. */
export function cellHash(ix: number, iy: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 0x8da6b343) ^ Math.imul(iy, 0xd8163841) ^ Math.imul(iz, 0xcb1ab31f) ^ seed;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : Math.min(x, hi);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
