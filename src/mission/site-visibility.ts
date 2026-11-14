// Gen Worlds © 2026 Echo Yin. PolyForm Noncommercial 1.0.0: see LICENSE.md.
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
import { elevationFromHourAngle } from '@/astro/planet-sky';
import { getBody } from '@/data/bodies';
import type { LandingSite, SkyModel } from '@/data/scenarios';
import { seasonFor } from '@/mission/local-sky';

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
  /** Greatest distance to Earth during the mission, au; null where the scenario fixes it. */
  earthDistanceAu: number | null;
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

/**
 * A rotating planet: the Sun and Earth rise and set every local day, with the season setting how
 * high they climb. Fills the hourly arrays and returns the greatest Earth distance, au.
 */
function fillDiurnalSky(
  sunVisible: Uint8Array,
  earthVisible: Uint8Array,
  site: LandingSite,
  landingJd: number,
  minSunClearanceDeg: number,
  minEarthClearanceDeg: number,
  sky: SkyModel,
  bodyId: string,
  linkDistanceAu: number,
): number {
  const body = getBody(bodyId);
  const latitude = site.latitudeDeg * DEG;
  const tilt = body.axialTiltDeg * DEG;
  const dayHours = body.solarDayS / 3600;
  const startHourAngle = ((sky.landingLocalHour - 12) / 24) * 2 * Math.PI;
  let farthest = 0;
  let season = seasonFor(sky, bodyId, landingJd, tilt, linkDistanceAu);
  for (let hour = 0; hour < sunVisible.length; hour++) {
    // The season moves slowly: once a day is plenty.
    if (hour % 24 === 0) {
      season = seasonFor(sky, bodyId, landingJd + hour / 24, tilt, linkDistanceAu);
      farthest = Math.max(farthest, season.earthDistanceAu);
    }
    const sunHourAngle = startHourAngle + (hour / dayHours) * 2 * Math.PI;
    const sun = elevationFromHourAngle(latitude, season.sunDeclination, sunHourAngle);
    // A body east of the Sun crosses the meridian later.
    const earth = elevationFromHourAngle(
      latitude,
      season.earthDeclination,
      sunHourAngle - season.earthElongation,
    );
    const heard = Math.abs(season.earthElongation) >= sky.conjunctionElongationDeg * DEG;
    sunVisible[hour] = sun >= minSunClearanceDeg * DEG ? 1 : 0;
    earthVisible[hour] = heard && earth >= minEarthClearanceDeg * DEG ? 1 : 0;
  }
  return farthest;
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
  sky: SkyModel | null = null,
  bodyId = 'moon',
  /** Distance of the link home where the sky model has no ephemeris for it, au. */
  linkDistanceAu = 0,
): SiteVisibility {
  const key = `${bodyId}|${site.id}|${landingJd}|${durationDays}|${minSunClearanceDeg}|${minEarthClearanceDeg}`;
  if (cacheValue && cacheKey === key) return cacheValue;

  const hours = Math.max(1, Math.round(durationDays * 24));
  const sunVisible = new Uint8Array(hours);
  const earthVisible = new Uint8Array(hours);
  let earthDistanceAu: number | null = null;
  if (sky && sky.model !== 'lunar') {
    earthDistanceAu = fillDiurnalSky(
      sunVisible,
      earthVisible,
      site,
      landingJd,
      minSunClearanceDeg,
      minEarthClearanceDeg,
      sky,
      bodyId,
      linkDistanceAu,
    );
  } else {
    for (let hour = 0; hour < hours; hour++) {
      const jd = landingJd + hour / 24;
      sunVisible[hour] = clearsHorizon(subSolarPoint(jd), site, minSunClearanceDeg) ? 1 : 0;
      earthVisible[hour] = clearsHorizon(subEarthPoint(jd), site, minEarthClearanceDeg) ? 1 : 0;
    }
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
    earthDistanceAu,
  };
  return cacheValue;
}
