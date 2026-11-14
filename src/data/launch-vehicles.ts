/** Launch vehicle catalog (source and units in `launch_vehicles.json`). */
import { camelize, indexById } from '@/data/camelize';
import raw from '@/data/launch_vehicles.json';
import type { TierId } from '@/data/mission-constants';

/** [x, payload kg]: x is C3 in km²/s² or altitude in km depending on the curve. */
export type CapacityPoint = readonly [number, number];

export interface LaunchVehicle {
  id: string;
  name: string;
  provider: string;
  costMusd: number;
  fairingDiameterM: number;
  /** Probability of a successful launch. */
  reliability: number;
  minTier: TierId;
  /** Payload to sun-synchronous orbit by altitude, ascending. */
  ssoCapacity: CapacityPoint[];
  /** Payload by launch energy, ascending; empty when the vehicle cannot reach escape. */
  c3Capacity: CapacityPoint[];
  summary: string;
}

export const LAUNCH_VEHICLES: readonly LaunchVehicle[] = camelize<LaunchVehicle[]>(raw.vehicles);

const BY_ID = indexById(LAUNCH_VEHICLES, 'launch vehicle');

export function getLaunchVehicle(id: string): LaunchVehicle {
  const vehicle = BY_ID.get(id);
  if (!vehicle) throw new Error(`Unknown launch vehicle "${id}".`);
  return vehicle;
}

/**
 * Payload a curve allows at `x`, by linear interpolation. Below the first point the first value
 * holds (an easier orbit never lifts less); beyond the last point the vehicle cannot do it: 0.
 */
export function capacityAt(curve: readonly CapacityPoint[], x: number): number {
  if (curve.length === 0) return 0;
  if (x <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    const [x1, y1] = curve[i];
    if (x <= x1) {
      const [x0, y0] = curve[i - 1];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return 0;
}
