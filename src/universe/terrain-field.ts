/**
 * Procedural planetary height field.
 *
 * `height()` maps a unit direction from the planet centre to metres above the datum radius. It is
 * band-limited by `minWavelength` so a coarse LOD chunk only pays for the octaves it can represent,
 * and finer chunks add octaves on top of exactly the same low-frequency shape (no LOD popping of the
 * large forms).
 *
 * Layers, large to small:
 *   continents   warped fBm shaped into plateaus, shelves and basins
 *   mountains    ridged multifractal gated by a tectonic mask
 *   hills/detail derivative-damped fBm (flattens valleys, keeps ridges: a cheap erosion look)
 *   canyons, terraces, dunes, craters depending on the planet class
 */
import { cellHash, clamp, lerp, Noise3, smoothstep } from '@/core/noise';
import { type HeightmapData, heightmapResolution, sampleHeightmap } from './heightmap';
import type { TerrainDesc } from './types';

const LACUNARITY = 2.03;

export class TerrainField {
  private readonly nContinent: Noise3;
  private readonly nWarp: Noise3;
  private readonly nMountain: Noise3;
  private readonly nDetail: Noise3;
  private readonly nMask: Noise3;
  private readonly scratch = new Float64Array(4);
  private readonly craterSeed: number;
  /** True for bodies without relief (gas giants): every query short-circuits to the datum. */
  private readonly flat: boolean;

  constructor(
    readonly desc: TerrainDesc,
    readonly radius: number,
    /** Measured elevation of a real body; replaces the generated continents and mountains. */
    readonly base: HeightmapData | null = null,
  ) {
    this.nContinent = new Noise3(desc.seed);
    this.nWarp = new Noise3(desc.seed ^ 0x1b873593);
    this.nMountain = new Noise3(desc.seed ^ 0x85ebca6b);
    this.nDetail = new Noise3(desc.seed ^ 0xc2b2ae35);
    this.nMask = new Noise3(desc.seed ^ 0x27d4eb2f);
    this.craterSeed = desc.seed ^ 0x165667b1;
    this.flat =
      desc.continentHeight === 0 &&
      desc.basinDepth === 0 &&
      desc.mountainHeight === 0 &&
      desc.hillHeight === 0;
  }

  /**
   * Height in metres above the datum for unit direction (dx, dy, dz).
   * @param minWavelength smallest feature the caller can represent, metres.
   */
  height(dx: number, dy: number, dz: number, minWavelength: number): number {
    if (this.flat) return 0;
    const d = this.desc;
    const R = this.radius;
    if (this.base) {
      // Real relief down to the data's resolution, generated relief only below it.
      const resolution = heightmapResolution(this.base, R);
      let real = sampleHeightmap(this.base, dx, dy, dz);
      real +=
        Math.min(d.hillHeight, 260) * 0.6 * this.erodedFbm(dx * R, dy * R, dz * R, resolution, minWavelength);
      if (d.craterDensity > 0) real += this.craters(dx, dy, dz, minWavelength, resolution * 1.5);
      return real;
    }
    let px = dx * R;
    let py = dy * R;
    let pz = dz * R;

    // Domain warp at half the continental wavelength: breaks up the isotropy of the base noise.
    const ws = 1 / (d.continentScale * 0.5);
    const wa = d.warp * d.continentScale;
    const wx = this.nWarp.eval(px * ws, py * ws, pz * ws);
    const wy = this.nWarp.eval(px * ws + 31.4, py * ws - 17.2, pz * ws + 5.9);
    const wz = this.nWarp.eval(px * ws - 11.7, py * ws + 43.1, pz * ws - 29.3);
    px += wx * wa;
    py += wy * wa;
    pz += wz * wa;

    // --- continents
    const c =
      this.fbm(this.nContinent, px, py, pz, d.continentScale, 7, 0.5, minWavelength) + d.continentBias;
    const land = smoothstep(-0.03, 0.12, c);
    let h: number;
    if (c >= 0) {
      h = d.continentHeight * (1 - Math.exp(-c * 5)) + c * c * d.continentHeight * 1.5;
    } else {
      // Continental shelf then abyssal plain.
      const s = smoothstep(0, 0.35, -c);
      h = -d.basinDepth * (0.12 * (1 - Math.exp(c * 30)) + 0.88 * s * s);
    }

    // --- mountains
    const ms = 1 / (d.mountainScale * 5);
    const maskN =
      this.nMask.eval(px * ms, py * ms, pz * ms) * 0.7 +
      this.nMask.eval(px * ms * 2.7, py * ms * 2.7, pz * ms * 2.7) * 0.3;
    const mountainMask = smoothstep(-0.05, 0.5, maskN) * (0.18 + 0.82 * land);
    let rugged = 0.15 + 0.5 * land;
    if (mountainMask > 0.002 && d.mountainHeight > 0) {
      const ridged = this.ridged(px, py, pz, d.mountainScale, minWavelength);
      h += d.mountainHeight * mountainMask * ridged;
      rugged += mountainMask * ridged * 1.2;
    }

    // --- hills and fine detail: one eroded fBm from 60 km down to the LOD limit
    h += d.hillHeight * rugged * this.erodedFbm(px, py, pz, 60e3, minWavelength);

    // --- canyons: narrow incised channels following the zero set of a low-frequency noise
    if (d.canyonDepth > 0) {
      const cs = 1 / (d.mountainScale * 2.2);
      const n = this.nMask.eval(px * cs + 91.7, py * cs + 13.3, pz * cs - 47.1);
      const n2 = this.nDetail.eval(px * cs * 6, py * cs * 6, pz * cs * 6) * 0.08;
      const channel = 1 - Math.abs(n + n2);
      const cut = smoothstep(0.9, 0.985, channel);
      if (cut > 0) h -= d.canyonDepth * cut * land * (0.4 + 0.6 * smoothstep(-0.2, 0.4, maskN + 0.3));
    }

    // --- terraces (mesas, stratified cliffs)
    if (d.terrace > 0 && h > 0) {
      const step = 220;
      const k = h / step;
      const f = k - Math.floor(k);
      const terraced = (Math.floor(k) + smoothstep(0.55, 0.95, f)) * step;
      h = lerp(h, terraced, d.terrace * clamp(rugged, 0, 1));
    }

    // --- dunes on flat lowlands
    if (d.duneHeight > 0 && minWavelength < 700) {
      const ds = 1 / 1400;
      const dn = this.nDetail.eval(px * ds * 1.0, py * ds * 1.0, pz * ds * 0.35);
      const crest = 1 - Math.abs(dn);
      const field =
        smoothstep(0.1, 0.5, this.nMask.eval(px / 90e3, py / 90e3, pz / 90e3) + 0.2) *
        (1 - clamp(rugged - 0.4, 0, 1));
      h += d.duneHeight * crest * crest * field;
    }

    // --- impact craters
    if (d.craterDensity > 0) h += this.craters(dx, dy, dz, minWavelength);

    return h;
  }

  /** Slow-varying moisture in 0..1 for biome selection. */
  moisture(dx: number, dy: number, dz: number): number {
    if (this.flat) return 0;
    const s = this.radius / (this.desc.continentScale * 0.7);
    const n =
      this.nMask.eval(dx * s + 7.7, dy * s + 3.1, dz * s - 5.3) * 0.65 +
      this.nMask.eval(dx * s * 3.1 - 2.2, dy * s * 3.1 + 9.4, dz * s * 3.1 + 1.6) * 0.35;
    return clamp(0.5 + 0.6 * n, 0, 1);
  }

  private fbm(
    noise: Noise3,
    x: number,
    y: number,
    z: number,
    wavelength: number,
    octaves: number,
    gain: number,
    minWavelength: number,
  ): number {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let wl = wavelength;
    for (let o = 0; o < octaves; o++) {
      const fade = clamp(wl / minWavelength - 1, 0, 1);
      if (fade <= 0) break;
      const f = 1 / wl;
      sum += amp * fade * noise.eval(x * f + o * 13.7, y * f - o * 7.3, z * f + o * 3.1);
      norm += amp;
      amp *= gain;
      wl /= LACUNARITY;
    }
    return norm > 0 ? (sum / norm) * 1.9 : 0;
  }

  /** Musgrave ridged multifractal, 0..~1. Weight feedback makes high ground rougher than valleys. */
  private ridged(x: number, y: number, z: number, wavelength: number, minWavelength: number): number {
    const sharp = 1 + this.desc.ridgeSharpness * 1.6;
    let sum = 0;
    let amp = 0.5;
    let weight = 1;
    let wl = wavelength;
    for (let o = 0; o < 20; o++) {
      const fade = clamp(wl / minWavelength - 1, 0, 1);
      if (fade <= 0) break;
      const f = 1 / wl;
      let s = 1 - Math.abs(this.nMountain.eval(x * f + o * 5.3, y * f + o * 9.1, z * f - o * 2.7));
      s = s ** sharp * weight;
      weight = clamp(s * 1.8, 0, 1);
      sum += s * amp * fade;
      amp *= 0.5;
      wl /= LACUNARITY;
    }
    return sum;
  }

  /**
   * fBm whose octaves are damped by the accumulated gradient of the octaves above (Quilez): steep
   * slopes stay rough, flats and valley floors fill in, which reads as erosion and deposition.
   */
  private erodedFbm(x: number, y: number, z: number, wavelength: number, minWavelength: number): number {
    const out = this.scratch;
    const k = this.desc.erosion;
    let sum = 0;
    let amp = 0.5;
    let gx = 0;
    let gy = 0;
    let gz = 0;
    let wl = wavelength;
    for (let o = 0; o < 24; o++) {
      const fade = clamp(wl / minWavelength - 1, 0, 1);
      if (fade <= 0) break;
      const f = 1 / wl;
      this.nDetail.evalD(x * f + o * 1.7, y * f - o * 4.1, z * f + o * 8.3, out);
      gx += out[1] * amp * 2;
      gy += out[2] * amp * 2;
      gz += out[3] * amp * 2;
      sum += (amp * fade * out[0]) / (1 + k * (gx * gx + gy * gy + gz * gz));
      amp *= 0.58; // H ≈ 0.8: natural terrain keeps more energy at kilometre scales than gain 0.5 gives
      wl /= LACUNARITY;
    }
    return sum;
  }

  /** Multi-scale crater field. Each scale is a jittered 3D grid of impact sites projected to the sphere. */
  private craters(
    dx: number,
    dy: number,
    dz: number,
    minWavelength: number,
    /** Largest crater cell to generate, m: larger craters are already in the measured base. */
    maxCell = Number.POSITIVE_INFINITY,
  ): number {
    const d = this.desc;
    const R = this.radius;
    const minCell = Math.max(minWavelength * 5, 40);
    let total = 0;
    let cell = R * 0.6;
    for (let s = 0; s < 18 && cell > minCell; s++, cell /= 2.1) {
      if (cell > maxCell) continue;
      const inv = 1 / cell;
      const px = dx * R * inv;
      const py = dy * R * inv;
      const pz = dz * R * inv;
      const bx = Math.floor(px - 0.5);
      const by = Math.floor(py - 0.5);
      const bz = Math.floor(pz - 0.5);
      const seed = this.craterSeed + s * 7919;
      // Small craters are far more numerous than large ones.
      const density = d.craterDensity * (s < 3 ? 0.35 : 0.8);
      for (let i = 0; i < 8; i++) {
        const cx = bx + (i & 1);
        const cy = by + ((i >> 1) & 1);
        const cz = bz + ((i >> 2) & 1);
        const h0 = cellHash(cx, cy, cz, seed);
        if (h0 > density) continue;
        // Site inside its cell, then projected onto the datum sphere.
        let sx = cx + 0.3 + 0.4 * cellHash(cx, cy, cz, seed + 1);
        let sy = cy + 0.3 + 0.4 * cellHash(cx, cy, cz, seed + 2);
        let sz = cz + 0.3 + 0.4 * cellHash(cx, cy, cz, seed + 3);
        const len = Math.sqrt(sx * sx + sy * sy + sz * sz);
        const shell = R * inv;
        // Only sites close to the surface shell produce craters, otherwise projection would smear them.
        if (Math.abs(len - shell) > 0.5) continue;
        const k = shell / len;
        sx *= k;
        sy *= k;
        sz *= k;
        const radius = 0.14 + 0.24 * cellHash(cx, cy, cz, seed + 4);
        const ddx = px - sx;
        const ddy = py - sy;
        const ddz = pz - sz;
        const dist = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz) / radius;
        if (dist > 2.2) continue;
        const rMetres = radius * cell;
        // Depth/diameter falls from 0.2 for simple bowls to shallow floors for large basins.
        const depth = Math.min(rMetres * 0.38, 900 + rMetres * 0.035) * d.craterDepth;
        const age = 0.35 + 0.65 * cellHash(cx, cy, cz, seed + 5);
        const rim = depth * 0.22;
        let ch: number;
        if (dist < 1) {
          const bowl = -depth * (1 - dist ** 2.6);
          ch = lerp(bowl, rim, smoothstep(0.72, 1, dist));
        } else {
          ch = rim * Math.exp(-(dist - 1) * 3.2);
        }
        total += ch * age;
      }
    }
    return total;
  }
}
