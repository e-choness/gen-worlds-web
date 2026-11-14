/**
 * The sky of a rotating planet as seen from a point on its surface: where the Sun and the Earth
 * stand through the local day and the seasons. A first-order model (the Earth is treated as lying in
 * the planet's orbital plane), good to a few degrees, which is what a power and link budget needs.
 */
import { AU, TAU } from '@/astro/constants';
import { planetState } from '@/astro/ephemeris';
import { wrapPi } from '@/astro/kepler';
import type { PlanetId } from '@/data/planet-elements';

export interface PlanetSeason {
  /** Areocentric-style solar longitude: 0 at the northern spring equinox, radians. */
  solarLongitude: number;
  /** Latitude of the sub-solar point, radians. */
  sunDeclination: number;
  /** Latitude of the sub-Earth point, radians. */
  earthDeclination: number;
  /** How far east of the Sun the Earth stands in the planet's sky, radians (negative = west). */
  earthElongation: number;
  earthDistanceAu: number;
}

/**
 * The slowly changing part of the sky, for one date.
 * @param axialTilt radians
 * @param equinoxLongitude heliocentric ecliptic longitude of the planet at its northern spring equinox, radians
 */
export function planetSeason(
  planet: PlanetId,
  jd: number,
  axialTilt: number,
  equinoxLongitude: number,
): PlanetSeason {
  const here = planetState(planet, jd).r;
  const earth = planetState('earth', jd).r;
  const heliocentric = Math.atan2(here[1], here[0]);
  const dx = earth[0] - here[0];
  const dy = earth[1] - here[1];
  const dz = earth[2] - here[2];
  // Seen from the planet the Sun lies opposite the planet's own heliocentric longitude.
  const sunLongitude = heliocentric + Math.PI;
  const earthLongitude = Math.atan2(dy, dx);
  const solarLongitude = (((heliocentric - equinoxLongitude) % TAU) + TAU) % TAU;
  const declination = (longitude: number): number =>
    Math.asin(Math.sin(axialTilt) * Math.sin(longitude - Math.PI - equinoxLongitude));
  return {
    solarLongitude,
    sunDeclination: declination(sunLongitude),
    earthDeclination: declination(earthLongitude),
    earthElongation: wrapPi(earthLongitude - sunLongitude),
    earthDistanceAu: Math.hypot(dx, dy, dz) / AU,
  };
}

/** Elevation above the ideal horizon of a body with the given declination and hour angle, radians. */
export function elevationFromHourAngle(latitude: number, declination: number, hourAngle: number): number {
  return Math.asin(
    Math.sin(latitude) * Math.sin(declination) +
      Math.cos(latitude) * Math.cos(declination) * Math.cos(hourAngle),
  );
}

/**
 * Compass bearing (radians from north, east positive) of a body with the given declination and
 * hour angle. The hour angle is positive after the body has crossed the meridian, so an afternoon
 * Sun bears west.
 */
export function bearingFromHourAngle(latitude: number, declination: number, hourAngle: number): number {
  return Math.atan2(
    -Math.cos(declination) * Math.sin(hourAngle),
    Math.sin(declination) * Math.cos(latitude) -
      Math.cos(declination) * Math.sin(latitude) * Math.cos(hourAngle),
  );
}
