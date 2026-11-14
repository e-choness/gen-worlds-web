// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0 or MIT: see LICENSE.md.
/**
 * Lunar trajectory mode: where the Sun and the Earth stand in the sky of a landing site on a date.
 * At the poles the Sun never climbs above about 1.5° and the Earth bobs about ±6.7° around the
 * horizon each month, so the landing date decides both solar power and direct-to-Earth comms.
 *
 * Sub-Earth and sub-solar points follow the optical libration formulae of J. Meeus, "Astronomical
 * Algorithms" (2nd ed.), chapter 53. Physical libration (< 0.04°) and terrain are ignored: local
 * horizon masks belong to the site data.
 */
import { DEG } from '@/astro/constants';
import { planetState } from '@/astro/ephemeris';
import { wrapPi } from '@/astro/kepler';
import { lunarArguments, moonEcliptic, PRECESSION_DEG_PER_CENTURY } from '@/astro/moon';
import { centuriesSinceJ2000 } from '@/astro/time';
import { length } from '@/astro/vec3';

/** Inclination of the Moon's mean equator to the ecliptic (IAU), radians. */
const LUNAR_EQUATOR_INCLINATION = 1.54242 * DEG;

export interface SubPoint {
  /** Selenographic latitude and longitude (east positive) of the point directly beneath, radians. */
  latitude: number;
  longitude: number;
}

/** Selenographic point beneath a body seen from the Moon at ecliptic (longitude, latitude) of the
 *  Moon as seen from that body. */
function subPoint(longitude: number, latitude: number, node: number, latitudeArgument: number): SubPoint {
  const w = longitude - node;
  const cosI = Math.cos(LUNAR_EQUATOR_INCLINATION);
  const sinI = Math.sin(LUNAR_EQUATOR_INCLINATION);
  const a = Math.atan2(
    Math.sin(w) * Math.cos(latitude) * cosI - Math.sin(latitude) * sinI,
    Math.cos(w) * Math.cos(latitude),
  );
  return {
    longitude: wrapPi(a - latitudeArgument),
    latitude: Math.asin(-Math.sin(w) * Math.cos(latitude) * sinI - Math.sin(latitude) * cosI),
  };
}

/** The point on the Moon where the Earth is at the zenith. */
export function subEarthPoint(jd: number): SubPoint {
  const moon = moonEcliptic(jd);
  const { node, latitudeArgument } = lunarArguments(jd);
  return subPoint(moon.longitude, moon.latitude, node, latitudeArgument);
}

/** The point on the Moon where the Sun is at the zenith. */
export function subSolarPoint(jd: number): SubPoint {
  const moon = moonEcliptic(jd);
  const { node, latitudeArgument } = lunarArguments(jd);
  const earth = planetState('earth', jd).r;
  const sunDistance = length(earth);
  // Geocentric longitude of the Sun, of date: opposite the Earth's heliocentric J2000 longitude.
  const sunLongitude =
    Math.atan2(earth[1], earth[0]) + Math.PI + PRECESSION_DEG_PER_CENTURY * centuriesSinceJ2000(jd) * DEG;
  // Heliocentric direction of the Moon: the Earth's, nudged by the Moon's small offset.
  const ratio = moon.distance / sunDistance;
  const heliocentricLongitude =
    sunLongitude + Math.PI + ratio * Math.cos(moon.latitude) * Math.sin(sunLongitude - moon.longitude);
  return subPoint(heliocentricLongitude, ratio * moon.latitude, node, latitudeArgument);
}

/**
 * Elevation above the ideal horizon (radians) of a body whose sub-point is `sub`, seen from a site
 * at the given selenographic latitude and longitude. Parallax is ignored (< 1° for the Earth).
 */
export function elevationAtSite(sub: SubPoint, siteLatitude: number, siteLongitude: number): number {
  return Math.asin(
    Math.sin(siteLatitude) * Math.sin(sub.latitude) +
      Math.cos(siteLatitude) * Math.cos(sub.latitude) * Math.cos(siteLongitude - sub.longitude),
  );
}

export interface SiteSky {
  /** Elevation of the Sun and of the Earth above the ideal horizon, radians. */
  sunElevation: number;
  earthElevation: number;
}

export function siteSky(jd: number, siteLatitude: number, siteLongitude: number): SiteSky {
  return {
    sunElevation: elevationAtSite(subSolarPoint(jd), siteLatitude, siteLongitude),
    earthElevation: elevationAtSite(subEarthPoint(jd), siteLatitude, siteLongitude),
  };
}

/**
 * Compass bearing (radians, 0 = north, increasing eastward, in [0, 2π)) from a site toward the point
 * beneath a body: the direction in which that body stands above the site's horizon.
 */
export function bearingToSubPoint(sub: SubPoint, siteLatitude: number, siteLongitude: number): number {
  const deltaLongitude = sub.longitude - siteLongitude;
  const bearing = Math.atan2(
    Math.sin(deltaLongitude) * Math.cos(sub.latitude),
    Math.cos(siteLatitude) * Math.sin(sub.latitude) -
      Math.sin(siteLatitude) * Math.cos(sub.latitude) * Math.cos(deltaLongitude),
  );
  return bearing < 0 ? bearing + 2 * Math.PI : bearing;
}
