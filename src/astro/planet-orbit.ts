/**
 * Orbit-around-a-planet mode (the Earth-observation scenario, and arrival orbits elsewhere): what
 * an altitude and inclination mean for coverage, eclipses, ground contact and lifetime.
 * All functions take the body's numbers as parameters; those live in the body catalog.
 */
import { DAY, TAU } from '@/astro/constants';
import { orbitalPeriod } from '@/astro/orbits';

export interface OrbitedBody {
  /** Gravitational parameter, m³/s². */
  mu: number;
  /** Equatorial radius, m. */
  radius: number;
  /** Oblateness coefficient J2 (dimensionless). */
  j2: number;
  /** Sidereal rotation period, s. */
  rotationPeriod: number;
  /** Orbital period around the Sun, s. */
  yearLength: number;
}

/** Period of a circular orbit at `altitude` (m above the equatorial radius), s. */
export function circularOrbitPeriod(body: OrbitedBody, altitude: number): number {
  return orbitalPeriod(body.mu, body.radius + altitude);
}

/**
 * Inclination (radians) at which the oblateness of the body turns the orbit plane once per year, so
 * the spacecraft crosses every latitude at the same local solar time: constant lighting for imaging.
 * Null when no inclination can do it at this altitude (too high).
 */
export function sunSynchronousInclination(body: OrbitedBody, altitude: number): number | null {
  const a = body.radius + altitude;
  const meanMotion = Math.sqrt(body.mu / (a * a * a));
  const requiredNodeRate = TAU / body.yearLength;
  const cosI = -requiredNodeRate / (1.5 * meanMotion * body.j2 * (body.radius / a) ** 2);
  return Math.abs(cosI) <= 1 ? Math.acos(cosI) : null;
}

/**
 * Fraction of each circular orbit spent in the body's shadow (cylindrical shadow).
 * `betaAngle` is the angle between the orbit plane and the Sun direction, radians: 0 is the worst
 * case (longest eclipses), and near 90° the orbit rides the terminator in permanent sunlight.
 */
export function eclipseFraction(body: OrbitedBody, altitude: number, betaAngle = 0): number {
  const r = body.radius + altitude;
  const cosBeta = Math.cos(betaAngle);
  const halfChord = Math.sqrt(altitude * altitude + 2 * body.radius * altitude);
  if (cosBeta <= 0 || halfChord >= r * cosBeta) return 0;
  return Math.acos(halfChord / (r * cosBeta)) / Math.PI;
}

/**
 * Angle at the body's centre between a ground station and the farthest point of an orbit at
 * `altitude` it can still see above `minElevation` (radians). Sets pass length and footprint size.
 */
export function visibilityAngle(body: OrbitedBody, altitude: number, minElevation: number): number {
  return Math.acos((body.radius * Math.cos(minElevation)) / (body.radius + altitude)) - minElevation;
}

/** Longest possible pass over a station (straight overhead), s. */
export function maxPassDuration(body: OrbitedBody, altitude: number, minElevation: number): number {
  return (visibilityAngle(body, altitude, minElevation) / Math.PI) * circularOrbitPeriod(body, altitude);
}

/**
 * Long-run fraction of time a circular orbit of the given inclination is in view of a ground station.
 * A satellite spends its time unevenly over latitude (most near ±inclination); the station sees the
 * share of that time that falls inside its visibility circle.
 */
export function contactFraction(
  body: OrbitedBody,
  altitude: number,
  inclination: number,
  stationLatitude: number,
  minElevation: number,
): number {
  const reach = visibilityAngle(body, altitude, minElevation);
  // Highest latitude the ground track reaches (retrograde orbits mirror prograde ones).
  const maxLatitude = Math.min(inclination, Math.PI - inclination);
  const latitude = Math.abs(stationLatitude);
  if (latitude > maxLatitude + reach) return 0;
  const capShare = (1 - Math.cos(reach)) / Math.PI;
  // Time density over latitude is 1/√(sin²i − sin²φ); cap its singularity at the track's edge.
  const spread = Math.sqrt(Math.max(Math.sin(maxLatitude) ** 2 - Math.sin(latitude) ** 2, 0));
  return Math.min(capShare / Math.max(spread, Math.sin(reach)), 1);
}

/** Width on the ground seen by a nadir instrument with full field of view `fieldOfView` (radians), m. */
export function swathWidth(altitude: number, fieldOfView: number): number {
  return 2 * altitude * Math.tan(fieldOfView / 2);
}

/**
 * Days for adjacent swaths to tile the equator once: the time to image the whole body in daylight
 * from a near-polar orbit. A wider swath or a higher orbit covers faster but sees less detail.
 */
export function globalCoverageDays(body: OrbitedBody, altitude: number, swath: number): number {
  // One daylight equator crossing per orbit, each laying one swath beside the earlier ones.
  const orbitsNeeded = (TAU * body.radius) / swath;
  return (orbitsNeeded * circularOrbitPeriod(body, altitude)) / DAY;
}

export interface AtmosphereLayer {
  /** Altitude at which this layer starts, m. Layers are sorted by ascending altitude. */
  baseAltitude: number;
  /** Density at the base, kg/m³. */
  baseDensity: number;
  /** e-folding height of the density within the layer, m. */
  scaleHeight: number;
}

/** Density from a piecewise-exponential atmosphere table, kg/m³. */
export function atmosphereDensity(layers: readonly AtmosphereLayer[], altitude: number): number {
  let layer = layers[0];
  for (const candidate of layers) {
    if (candidate.baseAltitude <= altitude) layer = candidate;
    else break;
  }
  return layer.baseDensity * Math.exp(-(altitude - layer.baseAltitude) / layer.scaleHeight);
}

/**
 * Time for drag to bring a circular orbit down to `reentryAltitude`, s (capped at `maxSeconds`).
 * `ballisticCoefficient` is mass / (drag coefficient × frontal area), kg/m²: a heavy, compact
 * spacecraft stays up longer than a light one with big panels.
 */
export function dragLifetime(
  body: OrbitedBody,
  layers: readonly AtmosphereLayer[],
  altitude: number,
  ballisticCoefficient: number,
  reentryAltitude: number,
  maxSeconds: number,
): number {
  let a = body.radius + altitude;
  let elapsed = 0;
  // Each step lowers the orbit by at most a tenth of a scale-height, so density stays resolved.
  for (let step = 0; step < 100000; step++) {
    const h = a - body.radius;
    if (h <= reentryAltitude) return elapsed;
    const decayRate = (Math.sqrt(body.mu * a) * atmosphereDensity(layers, h)) / ballisticCoefficient;
    let layer = layers[0];
    for (const candidate of layers) if (candidate.baseAltitude <= h) layer = candidate;
    const dt = (0.1 * layer.scaleHeight) / decayRate;
    if (elapsed + dt >= maxSeconds) return maxSeconds;
    a -= decayRate * dt;
    elapsed += dt;
  }
  return elapsed;
}
