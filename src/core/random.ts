// Gen Worlds © 2026 Echo Yin. PolyForm Noncommercial 1.0.0: see LICENSE.md.
/**
 * Deterministic randomness. All procedural content derives from 32-bit integer seeds so that any
 * object in the galaxy can be regenerated from (galaxy seed, address) alone — nothing is stored.
 */

/** Avalanche mix of a 32-bit integer (lowbias32). */
export function hash32(x: number): number {
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
  x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
  return (x ^ (x >>> 15)) >>> 0;
}

/** Combines any number of integers into one well-mixed 32-bit seed. */
export function hashCombine(...values: number[]): number {
  let h = 0x9e3779b9;
  for (const v of values) h = hash32(h ^ (v | 0)) + Math.imul(h, 0x85ebca6b);
  return hash32(h);
}

export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return hash32(h);
}

/** Small fast PRNG (sfc32) with convenience distributions. */
export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d = 1;

  constructor(seed: number) {
    this.a = hash32(seed);
    this.b = hash32(this.a ^ 0x68bc21eb);
    this.c = hash32(this.b ^ 0x02e5be93);
    for (let i = 0; i < 12; i++) this.nextU32();
  }

  nextU32(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = ((this.c << 21) | (this.c >>> 11)) + t;
    this.c |= 0;
    return t >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    return this.nextU32() / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Log-uniform in [min, max]: equal probability per decade. */
  logRange(min: number, max: number): number {
    return Math.exp(this.range(Math.log(min), Math.log(max)));
  }

  /** Standard normal (Box–Muller). */
  gaussian(mean = 0, sigma = 1): number {
    const u = Math.max(this.next(), 1e-12);
    const v = this.next();
    return mean + sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }

  /** Picks an index according to relative weights. */
  weighted(weights: readonly number[]): number {
    let total = 0;
    for (const w of weights) total += w;
    let r = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r <= 0) return i;
    }
    return weights.length - 1;
  }

  /** Derives an independent child generator. */
  fork(salt: number): Rng {
    return new Rng(hashCombine(this.nextU32(), salt));
  }
}
