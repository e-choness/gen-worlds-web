/**
 * The galaxy: an analytic stellar density field sampled into deterministic sectors.
 *
 * Nothing is stored. A sector's stars are a pure function of (galaxy seed, sector coordinates), so
 * sectors can be created on approach and dropped on departure without losing any state.
 */
import { hashCombine, Rng } from '@/core/random';
import { blackbody } from './color';
import { GALAXY_RADIUS_LY, GALAXY_THICKNESS_LY, SECTOR_SIZE_LY, SOLAR_RADIUS } from './constants';
import { starName } from './names';
import type { StarClass, StarDesc, Vec3Tuple } from './types';

export interface GalaxyParams {
  seed: number;
  armCount: number;
  /** Radians of winding per e-fold of radius (logarithmic spiral). */
  armWinding: number;
  armWidth: number;
  /** Stars per cubic light-year in the solar neighbourhood analogue. */
  localDensity: number;
}

export const DEFAULT_GALAXY: GalaxyParams = {
  seed: 0x5eed1234,
  armCount: 4,
  armWinding: 4.2,
  armWidth: 0.55,
  localDensity: 0.004,
};

interface ClassRow {
  cls: StarClass;
  weight: number;
  temp: [number, number];
  radius: [number, number];
  mass: [number, number];
  lum: [number, number];
}

/** Frequencies are skewed toward bright classes relative to reality so the sky has variety. */
const CLASS_TABLE: ClassRow[] = [
  { cls: 'M', weight: 52, temp: [2400, 3700], radius: [0.15, 0.7], mass: [0.08, 0.45], lum: [0.001, 0.08] },
  { cls: 'K', weight: 17, temp: [3700, 5200], radius: [0.7, 0.96], mass: [0.45, 0.8], lum: [0.08, 0.6] },
  { cls: 'G', weight: 11, temp: [5200, 6000], radius: [0.96, 1.15], mass: [0.8, 1.04], lum: [0.6, 1.5] },
  { cls: 'F', weight: 7, temp: [6000, 7500], radius: [1.15, 1.4], mass: [1.04, 1.4], lum: [1.5, 5] },
  { cls: 'A', weight: 4, temp: [7500, 10000], radius: [1.4, 1.8], mass: [1.4, 2.1], lum: [5, 25] },
  { cls: 'B', weight: 1.6, temp: [10000, 30000], radius: [1.8, 6.6], mass: [2.1, 16], lum: [25, 30000] },
  { cls: 'O', weight: 0.3, temp: [30000, 45000], radius: [6.6, 12], mass: [16, 60], lum: [30000, 500000] },
  { cls: 'WD', weight: 5, temp: [8000, 40000], radius: [0.008, 0.02], mass: [0.5, 1.3], lum: [0.0001, 0.05] },
  {
    cls: 'NS',
    weight: 0.7,
    temp: [40000, 40000],
    radius: [1.7e-5, 2e-5],
    mass: [1.4, 2.1],
    lum: [0.01, 0.2],
  },
  { cls: 'BH', weight: 0.4, temp: [1000, 1000], radius: [2e-5, 1.3e-4], mass: [5, 30], lum: [0, 0] },
];
const CLASS_WEIGHTS = CLASS_TABLE.map((r) => r.weight);

export class Galaxy {
  constructor(readonly params: GalaxyParams = DEFAULT_GALAXY) {}

  /** Relative stellar density at a galactic position (1 ≈ solar neighbourhood). */
  density(x: number, y: number, z: number): number {
    const { armCount, armWinding, armWidth } = this.params;
    const r = Math.hypot(x, z);
    const rn = r / GALAXY_RADIUS_LY;
    if (rn > 1.25) return 0;

    const scaleLength = GALAXY_RADIUS_LY * 0.22;
    const disk = Math.exp(-(r - GALAXY_RADIUS_LY * 0.5) / scaleLength);
    const h = GALAXY_THICKNESS_LY * (0.35 + 0.65 * Math.exp(-rn * 3));
    const sech = 1 / Math.cosh(y / h);
    const vertical = sech * sech;

    // Logarithmic spiral arms; contrast fades into the bulge and beyond the rim.
    const theta = Math.atan2(z, x);
    const phase = (theta - armWinding * Math.log(Math.max(r, 1) / (GALAXY_RADIUS_LY * 0.08))) * armCount;
    const arm = Math.exp((Math.cos(phase) - 1) / (armWidth * armWidth));
    const armMix = 0.25 + 1.5 * arm * smooth(0.06, 0.2, rn);

    const bulgeR = Math.hypot(r, y * 1.6) / (GALAXY_RADIUS_LY * 0.09);
    const bulge = 60 * Math.exp(-bulgeR * bulgeR);

    const rim = 1 - smooth(0.9, 1.2, rn);
    return (disk * armMix * vertical + bulge) * rim;
  }

  /** All stars of one sector, in a stable order. */
  sectorStars(sx: number, sy: number, sz: number): StarDesc[] {
    const { seed, localDensity } = this.params;
    const size = SECTOR_SIZE_LY;
    const cx = (sx + 0.5) * size;
    const cy = (sy + 0.5) * size;
    const cz = (sz + 0.5) * size;
    const rng = new Rng(hashCombine(seed, sx, sy, sz));
    const expected = Math.min(this.density(cx, cy, cz), 14) * localDensity * size * size * size;
    // Poisson-ish count: floor plus a Bernoulli for the fractional part.
    const count = Math.floor(expected) + (rng.chance(expected % 1) ? 1 : 0);
    const stars: StarDesc[] = [];
    for (let i = 0; i < count; i++) {
      const pos: Vec3Tuple = [(sx + rng.next()) * size, (sy + rng.next()) * size, (sz + rng.next()) * size];
      stars.push(makeStar(hashCombine(seed, sx, sy, sz, i), `${sx}:${sy}:${sz}:${i}`, pos));
    }
    return stars;
  }

  static sectorOf(positionLy: Vec3Tuple): Vec3Tuple {
    return [
      Math.floor(positionLy[0] / SECTOR_SIZE_LY),
      Math.floor(positionLy[1] / SECTOR_SIZE_LY),
      Math.floor(positionLy[2] / SECTOR_SIZE_LY),
    ];
  }
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function makeStar(seed: number, id: string, positionLy: Vec3Tuple): StarDesc {
  const rng = new Rng(seed);
  const row = CLASS_TABLE[rng.weighted(CLASS_WEIGHTS)];
  // One parameter t orders the star within its class so that T, R, M and L stay correlated.
  const t = rng.next();
  const lerpLog = (r: [number, number]) =>
    r[0] <= 0 ? 0 : Math.exp(Math.log(r[0]) + (Math.log(r[1]) - Math.log(r[0])) * t);
  const temperatureK = lerpLog(row.temp);
  const sub = 9 - Math.min(9, Math.floor(t * 10));
  let spectralType: string;
  switch (row.cls) {
    case 'WD':
      spectralType = `DA${Math.max(1, Math.round(50400 / temperatureK))}`;
      break;
    case 'NS':
      spectralType = 'Pulsar';
      break;
    case 'BH':
      spectralType = 'Black hole';
      break;
    default:
      spectralType = `${row.cls}${sub}V`;
  }
  return {
    id,
    seed,
    name: starName(rng),
    class: row.cls,
    spectralType,
    temperatureK,
    radius: lerpLog(row.radius) * SOLAR_RADIUS,
    massSolar: lerpLog(row.mass),
    luminositySolar: lerpLog(row.lum),
    color: row.cls === 'BH' ? [1, 0.6, 0.3] : blackbody(temperatureK),
    positionLy,
    ageGyr: rng.range(0.2, row.cls === 'O' || row.cls === 'B' ? 0.3 : 12),
  };
}
