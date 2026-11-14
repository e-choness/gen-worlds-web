// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0 or MIT: see LICENSE.md.
/**
 * Typed access to the JPL Keplerian elements (`ephemeris_planets.json` holds the source, frame and
 * units). The JSON uses snake_case keys; this loader is the one place that maps them.
 */
import raw from '@/data/ephemeris_planets.json';

export type PlanetId = 'mercury' | 'venus' | 'earth' | 'mars' | 'jupiter' | 'saturn' | 'uranus' | 'neptune';

/** [value at J2000, rate per Julian century]. */
export type ElementWithRate = readonly [number, number];

export interface PlanetElements {
  /** Semi-major axis, au. */
  a: ElementWithRate;
  e: ElementWithRate;
  /** Degrees, as are the three longitudes. */
  inclination: ElementWithRate;
  meanLongitude: ElementWithRate;
  longitudeOfPerihelion: ElementWithRate;
  longitudeOfNode: ElementWithRate;
}

function pair(values: number[]): ElementWithRate {
  return [values[0], values[1]];
}

/** "earth" is the Earth–Moon barycentre, which is within 4,700 km of the Earth's centre. */
export const PLANET_ELEMENTS = Object.fromEntries(
  Object.entries(raw.planets).map(([id, row]) => [
    id,
    {
      a: pair(row.a),
      e: pair(row.e),
      inclination: pair(row.inclination),
      meanLongitude: pair(row.mean_longitude),
      longitudeOfPerihelion: pair(row.longitude_of_perihelion),
      longitudeOfNode: pair(row.longitude_of_node),
    },
  ]),
) as Record<PlanetId, PlanetElements>;

export const PLANET_IDS = Object.keys(PLANET_ELEMENTS) as PlanetId[];
