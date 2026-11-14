/**
 * Hour-by-hour visibility of the Sun and the Earth from a lunar landing site over the surface
 * mission: real geometry from the ephemeris, cut by the site's horizon mask. This is what turns the
 * landing date into a power and communications decision.
 */
import { DEG } from '@/astro/constants';
import {
  bearingToSubPoint,
  elevationAtSite,
  type SubPoint,
  subEarthPoint,
  subSolarPoint,
} from '@/astro/lunar-geometry';
import type { LandingSite } from '@/data/scenarios';

export interface SiteVisibility {
  /** Julian date of the first sample (touchdown). */
  startJd: number;
  /** One entry per hour: 1 when the body clears the local horizon by the required amount. */
  sunVisible: Uint8Array;
  earthVisible: Uint8Array;
  /** Share of the hours with sunlight / with Earth in view. */
  sunFraction: number;
  earthFraction: number;
  /** Longest unbroken run without sunlight / without Earth, hours. */
  longestDarkHours: number;
  longestEarthOutageHours: number;
  /** Hours from touchdown until the first darkness longer than a day begins (Infinity if none). */
  hoursToFirstLongNight: number;
}

/** True when a body with sub-point `sub` stands at least `clearanceDeg` above the site's local horizon. */
export function clearsHorizon(sub: SubPoint, site: LandingSite, clearanceDeg: number): boolean {
  const latitude = site.latitudeDeg * DEG;
  const longitude = site.longitudeDeg * DEG;
  const elevationDeg = elevationAtSite(sub, latitude, longitude) / DEG;
  const sectors = site.horizonMaskDeg.length;
  // Interpolate the mask between sector centres so visibility does not flicker at sector edges.
  const position = (bearingToSubPoint(sub, latitude, longitude) / (2 * Math.PI)) * sectors;
  const lower = Math.floor(position) % sectors;
  const upper = (lower + 1) % sectors;
  const blend = position - Math.floor(position);
  const mask = site.horizonMaskDeg[lower] * (1 - blend) + site.horizonMaskDeg[upper] * blend;
  return elevationDeg >= mask + clearanceDeg;
}

function longestRunOfZeros(samples: Uint8Array): number {
  let longest = 0;
  let run = 0;
  for (const sample of samples) {
    run = sample ? 0 : run + 1;
    if (run > longest) longest = run;
  }
  return longest;
}

function fractionOfOnes(samples: Uint8Array): number {
  let ones = 0;
  for (const sample of samples) ones += sample;
  return samples.length ? ones / samples.length : 0;
}

let cacheKey = '';
let cacheValue: SiteVisibility | null = null;

/**
 * Samples the site's sky every hour for `durationDays` from `landingJd`.
 * The last result is cached: the budget panel asks again on every design change, and only the
 * site, date or duration change the answer.
 */
export function computeSiteVisibility(
  site: LandingSite,
  landingJd: number,
  durationDays: number,
  minSunClearanceDeg: number,
  minEarthClearanceDeg: number,
): SiteVisibility {
  const key = `${site.id}|${landingJd}|${durationDays}|${minSunClearanceDeg}|${minEarthClearanceDeg}`;
  if (cacheValue && cacheKey === key) return cacheValue;

  const hours = Math.max(1, Math.round(durationDays * 24));
  const sunVisible = new Uint8Array(hours);
  const earthVisible = new Uint8Array(hours);
  for (let hour = 0; hour < hours; hour++) {
    const jd = landingJd + hour / 24;
    sunVisible[hour] = clearsHorizon(subSolarPoint(jd), site, minSunClearanceDeg) ? 1 : 0;
    earthVisible[hour] = clearsHorizon(subEarthPoint(jd), site, minEarthClearanceDeg) ? 1 : 0;
  }

  let hoursToFirstLongNight = Number.POSITIVE_INFINITY;
  let run = 0;
  for (let hour = 0; hour < hours; hour++) {
    run = sunVisible[hour] ? 0 : run + 1;
    if (run > 24) {
      hoursToFirstLongNight = hour - run + 1;
      break;
    }
  }

  cacheKey = key;
  cacheValue = {
    startJd: landingJd,
    sunVisible,
    earthVisible,
    sunFraction: fractionOfOnes(sunVisible),
    earthFraction: fractionOfOnes(earthVisible),
    longestDarkHours: longestRunOfZeros(sunVisible),
    longestEarthOutageHours: longestRunOfZeros(earthVisible),
    hoursToFirstLongNight,
  };
  return cacheValue;
}
