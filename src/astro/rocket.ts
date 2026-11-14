// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0 or MIT: see LICENSE.md.
/** Tsiolkovsky rocket equation. Masses in kg, Δv in m/s, specific impulse in seconds. */
import { G0 } from '@/astro/constants';

/** Propellant needed to give `dryMass` (everything that is left after the burn) a change of `deltaV`. */
export function propellantMass(dryMass: number, deltaV: number, ispSeconds: number): number {
  return dryMass * (Math.exp(deltaV / (ispSeconds * G0)) - 1);
}

/** Δv available from burning down from `wetMass` to `dryMass`. */
export function deltaVFromMasses(wetMass: number, dryMass: number, ispSeconds: number): number {
  return ispSeconds * G0 * Math.log(wetMass / dryMass);
}

/** Propellant burned for a `deltaV` manoeuvre that starts at `wetMass`. */
export function propellantUsed(wetMass: number, deltaV: number, ispSeconds: number): number {
  return wetMass * (1 - Math.exp(-deltaV / (ispSeconds * G0)));
}
