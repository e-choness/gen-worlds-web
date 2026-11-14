// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
/**
 * Position of the Moon from the largest terms of the ELP series as tabulated by J. Meeus,
 * "Astronomical Algorithms" (2nd ed.), chapter 47. Accuracy is about 0.1° and a few hundred km,
 * enough for transfer timing, lighting and Earth visibility. (The JPL planetary elements have no Moon.)
 */
import { DEG } from '@/astro/constants';
import { centuriesSinceJ2000 } from '@/astro/time';
import type { Vec3 } from '@/astro/vec3';

/** General precession in longitude, degrees per Julian century: ecliptic of date ↔ J2000. */
export const PRECESSION_DEG_PER_CENTURY = 1.396971;

export interface LunarArguments {
  /** Mean longitude L′, mean elongation D, Sun's mean anomaly M, Moon's mean anomaly M′, argument
   *  of latitude F and longitude of the ascending node Ω: all in radians. */
  meanLongitude: number;
  elongation: number;
  sunAnomaly: number;
  moonAnomaly: number;
  latitudeArgument: number;
  node: number;
}

export function lunarArguments(jd: number): LunarArguments {
  const t = centuriesSinceJ2000(jd);
  return {
    meanLongitude: (218.3164477 + 481267.88123421 * t) * DEG,
    elongation: (297.8501921 + 445267.1114034 * t) * DEG,
    sunAnomaly: (357.5291092 + 35999.0502909 * t) * DEG,
    moonAnomaly: (134.9633964 + 477198.8675055 * t) * DEG,
    latitudeArgument: (93.272095 + 483202.0175233 * t) * DEG,
    node: (125.0445479 - 1934.1362891 * t) * DEG,
  };
}

export interface MoonEcliptic {
  /** Geocentric ecliptic longitude and latitude of date, radians. */
  longitude: number;
  latitude: number;
  /** Earth centre to Moon centre, m. */
  distance: number;
}

/** Geocentric ecliptic coordinates of the Moon, mean equinox of date. */
export function moonEcliptic(jd: number): MoonEcliptic {
  const {
    meanLongitude,
    elongation: d,
    sunAnomaly: m,
    moonAnomaly: mp,
    latitudeArgument: f,
  } = lunarArguments(jd);
  const longitudeDeg =
    6.288774 * Math.sin(mp) +
    1.274027 * Math.sin(2 * d - mp) +
    0.658314 * Math.sin(2 * d) +
    0.213618 * Math.sin(2 * mp) -
    0.185116 * Math.sin(m) -
    0.114332 * Math.sin(2 * f) +
    0.058793 * Math.sin(2 * d - 2 * mp) +
    0.057066 * Math.sin(2 * d - m - mp) +
    0.053322 * Math.sin(2 * d + mp) +
    0.045758 * Math.sin(2 * d - m);
  const latitudeDeg =
    5.128122 * Math.sin(f) +
    0.280602 * Math.sin(mp + f) +
    0.277693 * Math.sin(mp - f) +
    0.173237 * Math.sin(2 * d - f) +
    0.055413 * Math.sin(2 * d - mp + f) +
    0.046271 * Math.sin(2 * d - mp - f);
  const distanceKm =
    385000.56 -
    20905.355 * Math.cos(mp) -
    3699.111 * Math.cos(2 * d - mp) -
    2955.968 * Math.cos(2 * d) -
    569.925 * Math.cos(2 * mp) +
    48.888 * Math.cos(m);
  return {
    longitude: meanLongitude + longitudeDeg * DEG,
    latitude: latitudeDeg * DEG,
    distance: distanceKm * 1000,
  };
}

/** Geocentric position of the Moon in the ecliptic J2000 frame used by the planet ephemeris, m. */
export function moonPosition(jd: number): Vec3 {
  const { longitude, latitude, distance } = moonEcliptic(jd);
  const longitudeJ2000 = longitude - PRECESSION_DEG_PER_CENTURY * centuriesSinceJ2000(jd) * DEG;
  const cosLat = Math.cos(latitude);
  return [
    distance * cosLat * Math.cos(longitudeJ2000),
    distance * cosLat * Math.sin(longitudeJ2000),
    distance * Math.sin(latitude),
  ];
}
