// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0 or MIT: see LICENSE.md.
/**
 * The rocket-equation chain: equipment mass → propellant for the mission's manoeuvres → wet mass →
 * what the launcher must lift. Three budget lines come out of it (mass, Δv, launch) because each
 * is a different decision: what you carry, how you brake, and what you ride.
 */
import { G0 } from '@/astro/constants';
import { getBody } from '@/data/bodies';
import { capacityAt } from '@/data/launch-vehicles';
import { MISSION_CONSTANTS } from '@/data/mission-constants';
import { type BudgetLine, incompleteLine, statusFromMargin } from '@/mission/budget-line';
import { installedParts, type ResolvedDesign } from '@/mission/design';
import { num, percent } from '@/mission/format';

export interface MassChain {
  /** All installed parts, redundancy included, without tanks or propellant, kg. */
  equipmentMassKg: number;
  /** Planned manoeuvres, m/s. */
  correctionDeltaV: number;
  insertionDeltaV: number;
  descentDeltaV: number;
  /** Extra Δv loaded on top of the plan, m/s. */
  reserveDeltaV: number;
  totalDeltaV: number;
  /** False when no amount of propellant can deliver the Δv (the tanks outgrow what they add). */
  feasible: boolean;
  propellantKg: number;
  tankMassKg: number;
  /** Equipment plus tanks: the mass that reaches the surface, kg. */
  dryMassKg: number;
  wetMassKg: number;
  /** Mass at the start of the descent burn, kg. */
  descentStartMassKg: number;
  /** Thrust over local weight at the start of the descent. */
  descentThrustToWeight: number;
}

/** Null until a bus, propulsion, landing system and transfer are chosen. */
export function computeMassChain(resolved: ResolvedDesign): MassChain | null {
  const { propulsion, landing, transfer, scenario } = resolved;
  if (!propulsion || !landing || !transfer) return null;
  const equipmentMassKg = installedParts(resolved).reduce((sum, item) => sum + item.massKg, 0);
  const correctionDeltaV = transfer.correctionDeltaVMS;
  const insertionDeltaV = transfer.orbitInsertionDeltaVMS;
  const descentDeltaV = scenario.descent.deltaVMS * landing.descentDeltaVFactor;
  const planned = correctionDeltaV + insertionDeltaV + descentDeltaV;
  const reserveDeltaV = planned * MISSION_CONSTANTS.deltaVMargin.target;
  const totalDeltaV = planned + reserveDeltaV;

  const exhaustSpeed = propulsion.ispS * G0;
  const growth = Math.exp(totalDeltaV / exhaustSpeed) - 1;
  // m_p = (equipment + f·m_p)·growth  →  m_p = equipment·growth / (1 − f·growth)
  const denominator = 1 - propulsion.tankMassFraction * growth;
  const feasible = denominator > 0.02;
  const propellantKg = feasible ? (equipmentMassKg * growth) / denominator : Number.POSITIVE_INFINITY;
  const tankMassKg = propellantKg * propulsion.tankMassFraction;
  const dryMassKg = equipmentMassKg + tankMassKg;
  const wetMassKg = dryMassKg + propellantKg;
  const descentStartMassKg = wetMassKg * Math.exp(-(correctionDeltaV + insertionDeltaV) / exhaustSpeed);
  const gravity = getBody(scenario.targetBody).surfaceGravityMS2;
  return {
    equipmentMassKg,
    correctionDeltaV,
    insertionDeltaV,
    descentDeltaV,
    reserveDeltaV,
    totalDeltaV,
    feasible,
    propellantKg,
    tankMassKg,
    dryMassKg,
    wetMassKg,
    descentStartMassKg,
    descentThrustToWeight: propulsion.thrustN / (descentStartMassKg * gravity),
  };
}

/** Equipment carried against what the frame can hold. */
export function massLine(resolved: ResolvedDesign): BudgetLine {
  const { bus } = resolved;
  if (!bus) return incompleteLine('mass', 'Mass', 'kg', 'Choose a frame to see how much it can carry.');
  const installed = installedParts(resolved);
  const carried = installed.filter((item) => item.slot !== 'bus').reduce((sum, item) => sum + item.massKg, 0);
  const margin = 1 - carried / bus.payloadCapacityKg;
  const status = statusFromMargin(margin, MISSION_CONSTANTS.massMargin);
  const heaviest = installed
    .filter((item) => item.slot !== 'bus')
    .sort((a, b) => b.massKg - a.massKg)
    .slice(0, 3);
  const top = heaviest[0];
  let why: string;
  if (status === 'fail') {
    why = `The ${bus.name.toLowerCase()} carries ${num(bus.payloadCapacityKg)} kg and the equipment weighs ${num(carried)} kg. Remove ${num(carried - bus.payloadCapacityKg)} kg or choose a stronger frame${top ? `; the heaviest item is the ${top.part.name.toLowerCase()} at ${num(top.massKg)} kg` : ''}.`;
  } else if (status === 'warning') {
    why = `Only ${percent(margin)} of the frame's capacity is spare. Designs grow as they are built: NASA holds about ${percent(MISSION_CONSTANTS.massMargin.target)} at this stage.`;
  } else {
    why = `${num(carried)} kg of equipment on a frame rated for ${num(bus.payloadCapacityKg)} kg leaves ${percent(margin)} spare for growth.`;
  }
  return {
    id: 'mass',
    label: 'Mass',
    value: carried,
    limit: bus.payloadCapacityKg,
    unit: 'kg',
    margin,
    status,
    why,
    details: heaviest.map((item) => ({ label: item.part.name, value: item.massKg, unit: 'kg' })),
  };
}

/** The manoeuvres the spacecraft must fly and the propellant they cost. */
export function deltaVLine(resolved: ResolvedDesign, chain: MassChain | null): BudgetLine {
  const { propulsion, transfer, scenario } = resolved;
  if (!chain || !propulsion || !transfer) {
    return incompleteLine(
      'delta_v',
      'Propellant',
      'm/s',
      'Choose a propulsion stage, a landing system and a transfer to size the propellant load.',
    );
  }
  const details = [
    { label: 'Descent and landing', value: chain.descentDeltaV, unit: 'm/s' },
    { label: 'Orbit insertion', value: chain.insertionDeltaV, unit: 'm/s' },
    { label: 'Reserve', value: chain.reserveDeltaV, unit: 'm/s' },
    { label: 'Course corrections', value: chain.correctionDeltaV, unit: 'm/s' },
  ].filter((entry) => entry.value > 0);
  const base = {
    id: 'delta_v' as const,
    label: 'Propellant',
    unit: 'm/s',
    value: chain.totalDeltaV,
    details,
  };
  if (!chain.feasible) {
    return {
      ...base,
      limit: null,
      margin: null,
      status: 'fail',
      why: `The ${propulsion.name.toLowerCase()} (specific impulse ${num(propulsion.ispS)} s) cannot deliver ${num(chain.totalDeltaV)} m/s: every extra kilogram of propellant needs more tank than it can push. Choose a more efficient engine.`,
    };
  }
  if (transfer.durationDays > propulsion.maxCoastDays) {
    return {
      ...base,
      limit: null,
      margin: null,
      status: 'fail',
      why: `The ${propulsion.name.toLowerCase()} keeps its propellant for ${num(propulsion.maxCoastDays)} days and the ${transfer.name.toLowerCase()} takes ${num(transfer.durationDays)}. The tanks would be empty before the landing burn: take the faster transfer or a storable propellant.`,
    };
  }
  const required = scenario.descent.minThrustToWeight;
  if (chain.descentThrustToWeight < required) {
    return {
      ...base,
      limit: null,
      margin: chain.descentThrustToWeight / required - 1,
      status: 'fail',
      why: `At the start of the descent the vehicle weighs ${num(chain.descentStartMassKg)} kg and the engine lifts only ${num(chain.descentThrustToWeight, 2)} times its ${scenario.terms.localWeight}; a controlled landing needs ${num(required, 1)}. Cut mass or choose an engine with more thrust.`,
    };
  }
  const ratio = chain.propellantKg / chain.equipmentMassKg;
  return {
    ...base,
    limit: null,
    margin: MISSION_CONSTANTS.deltaVMargin.target,
    status: 'ok',
    why: `${num(chain.totalDeltaV)} m/s of manoeuvres with a specific impulse of ${num(propulsion.ispS)} s takes ${num(chain.propellantKg)} kg of propellant: ${num(ratio, 1)} kg for every kilogram of equipment you land. A ${percent(MISSION_CONSTANTS.deltaVMargin.target)} reserve is included.`,
  };
}

/** Wet mass plus adapter against the launcher's capacity at the transfer's launch energy. */
export function launchLine(resolved: ResolvedDesign, chain: MassChain | null): BudgetLine {
  const { vehicle, transfer, scenario } = resolved;
  if (!vehicle || !transfer || !chain) {
    return incompleteLine(
      'launch',
      'Launch',
      'kg',
      'Choose a launch vehicle and a transfer to check that the rocket can lift the spacecraft.',
    );
  }
  const capacity = capacityAt(vehicle.c3Capacity, transfer.c3Km2S2);
  const entryMassKg = chain.feasible ? chain.wetMassKg * (scenario.entry?.massFraction ?? 0) : 0;
  const needed = chain.feasible
    ? chain.wetMassKg + entryMassKg + scenario.launchAdapterMassKg
    : Number.POSITIVE_INFINITY;
  const details = [
    { label: 'Propellant', value: chain.propellantKg, unit: 'kg' },
    { label: 'Equipment', value: chain.equipmentMassKg, unit: 'kg' },
    { label: 'Tanks', value: chain.tankMassKg, unit: 'kg' },
    { label: 'Launch adapter', value: scenario.launchAdapterMassKg, unit: 'kg' },
    { label: 'Heat shield, parachute and cruise stage', value: entryMassKg, unit: 'kg' },
  ].filter((entry) => entry.value > 0);
  const base = {
    id: 'launch' as const,
    label: 'Launch',
    unit: 'kg',
    value: needed,
    limit: capacity,
    details,
  };
  if (capacity <= 0) {
    return {
      ...base,
      margin: -1,
      status: 'fail',
      why: `${vehicle.name} cannot send anything onto this transfer (launch energy ${num(transfer.c3Km2S2, 1)} km²/s²): it only reaches Earth orbit. Choose a larger rocket.`,
    };
  }
  const margin = 1 - needed / capacity;
  const status = statusFromMargin(margin, MISSION_CONSTANTS.massMargin);
  let why: string;
  if (status === 'fail') {
    why = `${vehicle.name} sends ${num(capacity)} kg onto the ${transfer.name.toLowerCase()} and the fuelled spacecraft weighs ${num(needed)} kg, ${num(needed - capacity)} kg too much. ${num(chain.propellantKg)} kg of that is propellant: A lighter design or a more efficient engine shrinks it fast${entryMassKg > 0 ? `, and every kilogram landed needs ${num(scenario.entry?.massFraction ?? 0, 1)} kg more of heat shield, parachute and cruise stage` : ''}.`;
  } else if (status === 'warning') {
    why = `${vehicle.name} lifts ${num(capacity)} kg and you need ${num(needed)} kg: only ${percent(margin)} spare. Any mass growth during the build would mean a bigger rocket.`;
  } else {
    why = `${vehicle.name} sends ${num(capacity)} kg onto the ${transfer.name.toLowerCase()}; the fuelled spacecraft and adapter weigh ${num(needed)} kg, leaving ${percent(margin)} spare.`;
  }
  return { ...base, margin, status, why };
}
