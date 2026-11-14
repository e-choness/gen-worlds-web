// Gen Worlds © 2026 Echo Yin. PolyForm Noncommercial 1.0.0: see LICENSE.md.
/**
 * Day-by-day sunlight and Earth visibility at a landing site across the whole landing window: the
 * picture a mission designer uses to choose the landing date.
 */
import { subEarthPoint, subSolarPoint } from '@/astro/lunar-geometry';
import type { LandingSite } from '@/data/scenarios';
import { clearsHorizon } from '@/mission/site-visibility';

export interface SiteCalendar {
  /** Julian date of day 0. */
  startJd: number;
  /** Share of each day (0–1) with the Sun / the Earth above the local horizon. */
  sunByDay: Float32Array;
  earthByDay: Float32Array;
}

/** Samples per day: every three hours resolves the 29.5-day cycle well. */
const SAMPLES_PER_DAY = 8;

let cacheKey = '';
let cacheValue: SiteCalendar | null = null;

/** Computes (and caches the last) calendar for `days` days from `startJd`. */
export function computeSiteCalendar(
  site: LandingSite,
  startJd: number,
  days: number,
  minSunClearanceDeg: number,
  minEarthClearanceDeg: number,
): SiteCalendar {
  const key = `${site.id}|${startJd}|${days}|${minSunClearanceDeg}|${minEarthClearanceDeg}`;
  if (cacheValue && cacheKey === key) return cacheValue;
  const sunByDay = new Float32Array(days);
  const earthByDay = new Float32Array(days);
  for (let day = 0; day < days; day++) {
    let sun = 0;
    let earth = 0;
    for (let sample = 0; sample < SAMPLES_PER_DAY; sample++) {
      const jd = startJd + day + sample / SAMPLES_PER_DAY;
      if (clearsHorizon(subSolarPoint(jd), site, minSunClearanceDeg)) sun++;
      if (clearsHorizon(subEarthPoint(jd), site, minEarthClearanceDeg)) earth++;
    }
    sunByDay[day] = sun / SAMPLES_PER_DAY;
    earthByDay[day] = earth / SAMPLES_PER_DAY;
  }
  cacheKey = key;
  cacheValue = { startJd, sunByDay, earthByDay };
  return cacheValue;
}
