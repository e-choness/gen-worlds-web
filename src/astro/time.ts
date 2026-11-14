// Gen Worlds © 2026 Echo Yin. PolyForm Noncommercial 1.0.0: see LICENSE.md.
/**
 * Time scales. The game treats UTC, TT and TDB as the same clock: they differ by about 69 s, far
 * below the accuracy of the approximate ephemerides used here.
 */
import { DAYS_PER_CENTURY, J2000_JD } from '@/astro/constants';

const UNIX_EPOCH_JD = 2440587.5;
const MS_PER_DAY = 86400000;

export function jdFromUnixMs(ms: number): number {
  return ms / MS_PER_DAY + UNIX_EPOCH_JD;
}

export function unixMsFromJd(jd: number): number {
  return (jd - UNIX_EPOCH_JD) * MS_PER_DAY;
}

/** Julian date of a UTC calendar date; `month` is 1–12 and `day` may carry a fraction. */
export function jdFromDate(year: number, month: number, day: number): number {
  return jdFromUnixMs(Date.UTC(year, month - 1, 1)) + (day - 1);
}

/** ISO calendar date (UTC) of a Julian date, e.g. "2026-11-14". */
export function isoDateFromJd(jd: number): string {
  return new Date(unixMsFromJd(jd)).toISOString().slice(0, 10);
}

/** Julian centuries since J2000, the time argument of the ephemeris series. */
export function centuriesSinceJ2000(jd: number): number {
  return (jd - J2000_JD) / DAYS_PER_CENTURY;
}
