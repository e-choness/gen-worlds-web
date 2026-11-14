// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
/**
 * Closed-form orbit relations: speeds, periods, Hohmann transfers and the burns that leave or enter
 * a planet's gravity well. SI units; radii are from the body's centre.
 */
import { TAU } from '@/astro/constants';

export function circularSpeed(mu: number, radius: number): number {
  return Math.sqrt(mu / radius);
}

/** Speed at `radius` on an orbit of semi-major axis `a` (vis-viva). */
export function visVivaSpeed(mu: number, radius: number, a: number): number {
  return Math.sqrt(mu * (2 / radius - 1 / a));
}

export function orbitalPeriod(mu: number, a: number): number {
  return TAU * Math.sqrt((a * a * a) / mu);
}

export interface HohmannTransfer {
  /** Burn at the starting circular orbit, m/s (always positive). */
  deltaV1: number;
  /** Burn that circularises at the target radius, m/s (always positive). */
  deltaV2: number;
  /** Half the transfer ellipse period, s. */
  timeOfFlight: number;
}

/** Two-burn minimum-energy transfer between coplanar circular orbits. */
export function hohmannTransfer(mu: number, r1: number, r2: number): HohmannTransfer {
  const a = (r1 + r2) / 2;
  return {
    deltaV1: Math.abs(visVivaSpeed(mu, r1, a) - circularSpeed(mu, r1)),
    deltaV2: Math.abs(circularSpeed(mu, r2) - visVivaSpeed(mu, r2, a)),
    timeOfFlight: orbitalPeriod(mu, a) / 2,
  };
}

/**
 * Burn that takes a spacecraft from a circular parking orbit to a hyperbolic excess speed `vInfinity`
 * (the injection burn). Launch energy is `C3 = vInfinity²`.
 */
export function departureDeltaV(mu: number, parkingRadius: number, vInfinity: number): number {
  return Math.sqrt(vInfinity * vInfinity + (2 * mu) / parkingRadius) - circularSpeed(mu, parkingRadius);
}

/**
 * Burn at periapsis that captures from a hyperbolic approach at `vInfinity` into an orbit with the
 * given periapsis and apoapsis radii (equal radii = circular). A high apoapsis is cheap to enter
 * and expensive in everything else: long period, poor coverage.
 */
export function captureDeltaV(
  mu: number,
  vInfinity: number,
  periapsisRadius: number,
  apoapsisRadius = periapsisRadius,
): number {
  const approachSpeed = Math.sqrt(vInfinity * vInfinity + (2 * mu) / periapsisRadius);
  return approachSpeed - visVivaSpeed(mu, periapsisRadius, (periapsisRadius + apoapsisRadius) / 2);
}

/** Speed of an entry probe at `radius` when it arrives with `vInfinity` and does not brake. */
export function entrySpeed(mu: number, vInfinity: number, radius: number): number {
  return Math.sqrt(vInfinity * vInfinity + (2 * mu) / radius);
}
