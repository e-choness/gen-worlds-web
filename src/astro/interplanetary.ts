// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
/**
 * Interplanetary trajectory mode: Lambert transfers between planets and the porkchop grid.
 * Patched conics: the heliocentric leg is solved between planet centres, and the excess velocity at
 * each end becomes the launch energy (C3) and the arrival speed the spacecraft must brake from.
 */
import { DAY, MU_SUN } from '@/astro/constants';
import { planetState } from '@/astro/ephemeris';
import { solveLambert } from '@/astro/lambert';
import { length, sub, type Vec3 } from '@/astro/vec3';
import type { PlanetId } from '@/data/planet-elements';

export interface PlanetTransfer {
  departureJd: number;
  arrivalJd: number;
  /** Launch energy v∞², m²/s². Divide by 1e6 for the usual km²/s². */
  c3: number;
  /** Hyperbolic excess speed leaving the departure planet, m/s. */
  vInfinityDeparture: number;
  /** Hyperbolic excess speed reaching the arrival planet, m/s. */
  vInfinityArrival: number;
  /** Heliocentric state at departure (ecliptic J2000, m and m/s): enough to propagate the cruise. */
  r1: Vec3;
  v1: Vec3;
}

/** The ballistic transfer between two planets for given dates, or null when none exists. */
export function planTransfer(
  from: PlanetId,
  to: PlanetId,
  departureJd: number,
  arrivalJd: number,
): PlanetTransfer | null {
  if (arrivalJd <= departureJd) return null;
  const departure = planetState(from, departureJd);
  const arrival = planetState(to, arrivalJd);
  const solution = solveLambert(departure.r, arrival.r, (arrivalJd - departureJd) * DAY, MU_SUN);
  if (!solution) return null;
  const vInfinityDeparture = length(sub(solution.v1, departure.v));
  const vInfinityArrival = length(sub(solution.v2, arrival.v));
  if (!Number.isFinite(vInfinityDeparture) || !Number.isFinite(vInfinityArrival)) return null;
  return {
    departureJd,
    arrivalJd,
    c3: vInfinityDeparture * vInfinityDeparture,
    vInfinityDeparture,
    vInfinityArrival,
    r1: departure.r,
    v1: solution.v1,
  };
}

export interface PorkchopRequest {
  from: PlanetId;
  to: PlanetId;
  departureJdStart: number;
  departureJdEnd: number;
  /** Number of departure dates (columns), ≥ 2. */
  columns: number;
  arrivalJdStart: number;
  arrivalJdEnd: number;
  /** Number of arrival dates (rows), ≥ 2. */
  rows: number;
}

export interface PorkchopGrid extends PorkchopRequest {
  /** Launch energy in km²/s², row-major (`row * columns + column`); NaN where no transfer exists. */
  c3: Float32Array;
  /** Arrival excess speed in km/s, same layout. */
  vInfinityArrival: Float32Array;
  /** Cell with the lowest launch energy, or null if the grid has no valid transfer. */
  best: { column: number; row: number } | null;
}

export function porkchopDepartureJd(grid: PorkchopRequest, column: number): number {
  return (
    grid.departureJdStart + ((grid.departureJdEnd - grid.departureJdStart) * column) / (grid.columns - 1)
  );
}

export function porkchopArrivalJd(grid: PorkchopRequest, row: number): number {
  return grid.arrivalJdStart + ((grid.arrivalJdEnd - grid.arrivalJdStart) * row) / (grid.rows - 1);
}

/** Evaluates the whole grid. A 120 × 120 grid takes a few tens of milliseconds: run it in a worker. */
export function computePorkchop(request: PorkchopRequest): PorkchopGrid {
  const { columns, rows } = request;
  const c3 = new Float32Array(columns * rows).fill(Number.NaN);
  const vInfinityArrival = new Float32Array(columns * rows).fill(Number.NaN);
  let best: PorkchopGrid['best'] = null;
  let bestC3 = Number.POSITIVE_INFINITY;
  for (let row = 0; row < rows; row++) {
    const arrivalJd = porkchopArrivalJd(request, row);
    for (let column = 0; column < columns; column++) {
      const transfer = planTransfer(
        request.from,
        request.to,
        porkchopDepartureJd(request, column),
        arrivalJd,
      );
      if (!transfer) continue;
      const index = row * columns + column;
      c3[index] = transfer.c3 / 1e6;
      vInfinityArrival[index] = transfer.vInfinityArrival / 1e3;
      if (transfer.c3 < bestC3) {
        bestC3 = transfer.c3;
        best = { column, row };
      }
    }
  }
  return { ...request, c3, vInfinityArrival, best };
}
