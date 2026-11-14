// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
/**
 * Planet positions from the JPL approximate Keplerian elements (valid 1800–2050, errors of
 * arc-minutes: plenty for launch windows and for placing planets in the renderer).
 * Frame: heliocentric, mean ecliptic and equinox of J2000. Units: metres and metres per second.
 */
import { AU, DEG, MU_SUN } from '@/astro/constants';
import { elementsToState, type OrbitalElements, type StateVector } from '@/astro/kepler';
import { centuriesSinceJ2000 } from '@/astro/time';
import { PLANET_ELEMENTS, type PlanetId } from '@/data/planet-elements';

/** Osculating-style elements of a planet at a Julian date (angles in radians, a in metres). */
export function planetElements(planet: PlanetId, jd: number): OrbitalElements {
  const table = PLANET_ELEMENTS[planet];
  const t = centuriesSinceJ2000(jd);
  const at = (element: readonly [number, number]): number => element[0] + element[1] * t;
  const longitudeOfPerihelion = at(table.longitudeOfPerihelion);
  const longitudeOfNode = at(table.longitudeOfNode);
  return {
    a: at(table.a) * AU,
    e: at(table.e),
    inclination: at(table.inclination) * DEG,
    longitudeOfNode: longitudeOfNode * DEG,
    argumentOfPeriapsis: (longitudeOfPerihelion - longitudeOfNode) * DEG,
    meanAnomaly: (at(table.meanLongitude) - longitudeOfPerihelion) * DEG,
  };
}

/** Heliocentric position and velocity of a planet. The velocity is the two-body one (rates ignored). */
export function planetState(planet: PlanetId, jd: number): StateVector {
  return elementsToState(planetElements(planet, jd), MU_SUN);
}

/** Mean time between identical Sun–planet–planet alignments (launch-window spacing), in days. */
export function synodicPeriodDays(a: PlanetId, b: PlanetId): number {
  const ratePerCentury = Math.abs(PLANET_ELEMENTS[a].meanLongitude[1] - PLANET_ELEMENTS[b].meanLongitude[1]);
  return (360 / ratePerCentury) * 36525;
}
