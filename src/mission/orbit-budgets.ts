// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
/**
 * The budgets of a mission flown in orbit. An orbiter has no landing to pay for: its propellant
 * holds the orbit against drag and brings it down at the end, its power has to bridge an eclipse
 * every ninety minutes, and its launch is judged by what a rocket lifts to that altitude.
 */
import { G0 } from '@/astro/constants';
import { capacityAt } from '@/data/launch-vehicles';
import { MISSION_CONSTANTS } from '@/data/mission-constants';
import { type BudgetLine, incompleteLine, statusFromMargin } from '@/mission/budget-line';
import { installedParts, type ResolvedDesign } from '@/mission/design';
import { duration, num, percent } from '@/mission/format';
import type { MassChain } from '@/mission/mass-budget';
import type { OrbitModel } from '@/mission/orbit-model';
import type { PowerModel } from '@/mission/power-budget';
import type { SiteVisibility } from '@/mission/site-visibility';

const DAYS_PER_YEAR = 365.25;
/** Share of the time an electric or chemical thruster draws its power while holding the orbit. */
const THRUSTER_DUTY = 0.2;
/** Spreads lit and in-contact hours evenly through the mission (golden-ratio sequence). */
const GOLDEN = 0.6180339887498949;

/** Null until an orbit is chosen. Without a thruster the chain carries no propellant at all. */
export function computeOrbitMassChain(resolved: ResolvedDesign, orbit: OrbitModel | null): MassChain | null {
  if (!orbit) return null;
  const { propulsion, scenario } = resolved;
  const equipmentMassKg = installedParts(resolved).reduce((sum, item) => sum + item.massKg, 0);
  const years = scenario.surfaceDurationDays / DAYS_PER_YEAR;
  const maintenance = propulsion ? orbit.maintenanceDeltaVPerYear * years : 0;
  const deorbit = propulsion ? orbit.deorbitDeltaV : 0;
  const planned = maintenance + deorbit;
  const reserveDeltaV = planned * MISSION_CONSTANTS.deltaVMargin.target;
  const totalDeltaV = planned + reserveDeltaV;
  let propellantKg = 0;
  let tankMassKg = 0;
  let feasible = true;
  if (propulsion && totalDeltaV > 0) {
    const growth = Math.exp(totalDeltaV / (propulsion.ispS * G0)) - 1;
    const denominator = 1 - propulsion.tankMassFraction * growth;
    feasible = denominator > 0.02;
    propellantKg = feasible ? (equipmentMassKg * growth) / denominator : Number.POSITIVE_INFINITY;
    tankMassKg = propellantKg * propulsion.tankMassFraction;
  }
  const dryMassKg = equipmentMassKg + tankMassKg;
  const wetMassKg = dryMassKg + propellantKg;
  return {
    equipmentMassKg,
    correctionDeltaV: maintenance,
    insertionDeltaV: 0,
    descentDeltaV: deorbit,
    reserveDeltaV,
    totalDeltaV,
    feasible,
    propellantKg,
    tankMassKg,
    dryMassKg,
    wetMassKg,
    descentStartMassKg: wetMassKg,
    descentThrustToWeight: Number.POSITIVE_INFINITY,
  };
}

/**
 * The orbit as the power and data models read it: the share of time in sunlight and in contact,
 * spread hour by hour so the mission dashboard has something to draw.
 */
export function orbitVisibility(orbit: OrbitModel, durationDays: number): SiteVisibility {
  const hours = Math.max(1, Math.round(durationDays * 24));
  const sunVisible = new Uint8Array(hours);
  const earthVisible = new Uint8Array(hours);
  const sunFraction = 1 - orbit.eclipseFraction;
  for (let hour = 0; hour < hours; hour++) {
    const phase = ((hour + 1) * GOLDEN) % 1;
    sunVisible[hour] = phase < sunFraction ? 1 : 0;
    earthVisible[hour] = ((hour + 1) * GOLDEN * GOLDEN) % 1 < orbit.contactFraction ? 1 : 0;
  }
  return {
    startJd: 0,
    sunVisible,
    earthVisible,
    sunFraction,
    earthFraction: orbit.contactFraction,
    longestDarkHours: orbit.eclipseHours,
    longestEarthOutageHours: orbit.longestGapHours,
    hoursToFirstLongNight: Number.POSITIVE_INFINITY,
    earthDistanceAu: null,
  };
}

/** Average electrical load over an orbit, W: imaging in daylight, the radio during passes, heaters in shadow. */
export function orbitAverageLoadW(resolved: ResolvedDesign, power: PowerModel, orbit: OrbitModel): number {
  const ops = resolved.scenario.operations;
  return (
    power.baseLoadW +
    power.scienceLoadW * ops.scienceFraction * (1 - orbit.eclipseFraction) +
    power.commsLoadW * orbit.contactFraction +
    power.heaterShadowW * orbit.eclipseFraction +
    (resolved.propulsion?.powerW ?? 0) * THRUSTER_DUTY
  );
}

/** Load carried by the battery alone while the satellite is in shadow, W. */
export function eclipseLoadW(resolved: ResolvedDesign, power: PowerModel): number {
  return power.baseLoadW + power.heaterShadowW + (resolved.propulsion?.powerW ?? 0) * THRUSTER_DUTY;
}

/** Orbit-average generation against orbit-average load. */
export function orbitPowerLine(
  resolved: ResolvedDesign,
  power: PowerModel | null,
  orbit: OrbitModel | null,
): BudgetLine {
  if (!power || !orbit || !resolved.power) {
    return incompleteLine(
      'power',
      'Power',
      'W',
      'Choose a power source, a battery, a thermal design and an orbit to see the power balance.',
    );
  }
  const generation = power.solarLitW * (1 - orbit.eclipseFraction) + power.rtgW;
  const load = orbitAverageLoadW(resolved, power, orbit);
  const margin = generation > 0 ? 1 - load / generation : -1;
  const status = statusFromMargin(margin, MISSION_CONSTANTS.powerMargin);
  const ops = resolved.scenario.operations;
  const details = [
    { label: 'Always-on systems', value: power.baseLoadW, unit: 'W' },
    { label: 'Instruments (average)', value: power.scienceLoadW * ops.scienceFraction, unit: 'W' },
    { label: 'Radio (average)', value: power.commsLoadW * orbit.contactFraction, unit: 'W' },
    { label: 'Thruster (average)', value: (resolved.propulsion?.powerW ?? 0) * THRUSTER_DUTY, unit: 'W' },
  ]
    .filter((entry) => entry.value > 0)
    .sort((a, b) => b.value - a.value);
  const sun =
    orbit.eclipseFraction === 0
      ? `The ${resolved.power.name.toLowerCase()} gives ${num(power.solarLitW)} W, and this orbit never enters Earth's shadow, so it gives that all the time`
      : `The ${resolved.power.name.toLowerCase()} gives ${num(power.solarLitW)} W in sunlight; ${percent(orbit.eclipseFraction)} of every orbit is in Earth's shadow, so it averages ${num(generation)} W`;
  let why: string;
  if (status === 'fail') {
    why = `${sun}. The satellite draws ${num(load)} W on average${details[0] ? `, most of it for ${details[0].label.toLowerCase()}` : ''}. It would drain its battery a little more on every orbit: add solar area or cut the load.`;
  } else if (status === 'warning') {
    why = `${sun} against an average draw of ${num(load)} W: only ${percent(margin)} spare. Solar cells lose a few percent a year, so the margin shrinks as the mission goes on.`;
  } else {
    why = `${sun} against an average draw of ${num(load)} W, leaving ${percent(margin)} spare.`;
  }
  return {
    id: 'power',
    label: 'Power',
    value: load,
    limit: generation,
    unit: 'W',
    margin,
    status,
    why,
    details,
  };
}

/** Usable battery against the energy one eclipse takes. */
export function eclipseLine(
  resolved: ResolvedDesign,
  power: PowerModel | null,
  orbit: OrbitModel | null,
): BudgetLine {
  if (!power || !orbit) {
    return incompleteLine(
      'thermal',
      'Eclipse',
      'Wh',
      'Choose a battery and an orbit to see whether it lasts through each eclipse.',
    );
  }
  const neededWh = eclipseLoadW(resolved, power) * orbit.eclipseHours;
  const base = {
    id: 'thermal' as const,
    label: 'Eclipse',
    unit: 'Wh',
    value: power.usableBatteryWh,
    limit: neededWh,
    details: [
      { label: 'Longest eclipse', value: orbit.eclipseHours * 60, unit: 'min' },
      { label: 'Draw in shadow', value: eclipseLoadW(resolved, power), unit: 'W' },
      { label: 'Heaters in shadow', value: power.heaterShadowW, unit: 'W' },
    ],
  };
  if (neededWh === 0) {
    return {
      ...base,
      margin: 9.99,
      status: 'ok',
      why: `This orbit rides the line between day and night and never enters Earth's shadow: the battery only has to cover the launch and emergencies.`,
    };
  }
  const margin = Math.min(power.usableBatteryWh / neededWh - 1, 9.99);
  const eclipse = `About ${num(orbit.eclipseHours * 60, 0)} minutes of every ${num(orbit.periodS / 60, 0)}-minute orbit are in shadow, when the satellite draws ${num(neededWh)} Wh from the battery`;
  if (margin < 0) {
    return {
      ...base,
      margin,
      status: 'fail',
      why: `${eclipse}, and only ${num(power.usableBatteryWh)} Wh can be used without wearing the cells out. The satellite would brown out on every orbit: fit a larger battery.`,
    };
  }
  const status = statusFromMargin(margin, MISSION_CONSTANTS.powerMargin);
  return {
    ...base,
    margin,
    status,
    why:
      status === 'ok'
        ? `${eclipse}; ${num(power.usableBatteryWh)} Wh is usable, fifteen times a day for the whole mission.`
        : `${eclipse}, and ${num(power.usableBatteryWh)} Wh is usable: only ${percent(margin)} spare. Batteries fade with every cycle, and this one cycles fifteen times a day.`,
  };
}

/** Holding the orbit against drag and leaving it afterwards. */
export function orbitDeltaVLine(
  resolved: ResolvedDesign,
  chain: MassChain | null,
  orbit: OrbitModel | null,
): BudgetLine {
  const { propulsion, scenario } = resolved;
  const mission = scenario.orbit;
  if (!chain || !orbit || !mission) {
    return incompleteLine(
      'delta_v',
      'Orbit upkeep',
      'm/s',
      'Choose an orbit to see how long the satellite stays up and what it takes to bring it down.',
    );
  }
  const missionYears = scenario.surfaceDurationDays / DAYS_PER_YEAR;
  const lifetime =
    orbit.naturalLifetimeYears >= 59
      ? 'for many decades'
      : orbit.naturalLifetimeYears < 1
        ? `for about ${num(orbit.naturalLifetimeYears * DAYS_PER_YEAR, 0)} days`
        : `for about ${num(orbit.naturalLifetimeYears, 1)} years`;
  const base = {
    id: 'delta_v' as const,
    label: 'Orbit upkeep',
    unit: 'm/s',
    value: chain.totalDeltaV,
    limit: null,
    details: [
      { label: 'Holding the orbit', value: chain.correctionDeltaV, unit: 'm/s' },
      { label: 'Deorbit burn', value: chain.descentDeltaV, unit: 'm/s' },
      { label: 'Reserve', value: chain.reserveDeltaV, unit: 'm/s' },
    ].filter((entry) => entry.value > 0),
  };
  if (!propulsion) {
    if (orbit.naturalLifetimeYears < missionYears) {
      return {
        ...base,
        margin: orbit.naturalLifetimeYears / missionYears - 1,
        status: 'warning',
        why: `At ${num(orbit.altitudeKm)} km the thin air drags this satellite down ${lifetime}, and the mission is meant to last ${num(scenario.surfaceDurationDays)} days. Without a thruster it burns up early: fly higher or add propulsion.`,
      };
    }
    if (orbit.naturalLifetimeYears > missionYears + mission.debrisRuleYears) {
      return {
        ...base,
        margin: -1,
        status: 'fail',
        why: `With no thruster the dead satellite would stay at ${num(orbit.altitudeKm)} km ${lifetime}. The orbital debris rule gives it ${mission.debrisRuleYears} years after the mission to be gone: fly lower, or carry a thruster to bring it down.`,
      };
    }
    return {
      ...base,
      margin: null,
      status: 'ok',
      why: `No thruster needed: the satellite stays up ${lifetime}, long enough for the mission, and drag then removes it inside the ${mission.debrisRuleYears}-year disposal rule.`,
    };
  }
  if (!chain.feasible) {
    return {
      ...base,
      margin: null,
      status: 'fail',
      why: `The ${propulsion.name.toLowerCase()} (specific impulse ${num(propulsion.ispS)} s) cannot deliver ${num(chain.totalDeltaV)} m/s: its tanks would outweigh the satellite. Choose a more efficient thruster or a higher orbit with less drag.`,
    };
  }
  return {
    ...base,
    margin: MISSION_CONSTANTS.deltaVMargin.target,
    status: 'ok',
    why: `Holding ${num(orbit.altitudeKm)} km against drag takes ${num(chain.correctionDeltaV, 1)} m/s over the mission and the deorbit burn ${num(chain.descentDeltaV)} m/s: ${num(chain.propellantKg, 1)} kg of propellant with the ${propulsion.name.toLowerCase()}. Left alone the satellite would stay up ${lifetime}.`,
  };
}

/** Fuelled satellite plus adapter against what the rocket lifts to this altitude. */
export function orbitLaunchLine(
  resolved: ResolvedDesign,
  chain: MassChain | null,
  orbit: OrbitModel | null,
): BudgetLine {
  const { vehicle, scenario } = resolved;
  if (!vehicle || !chain || !orbit) {
    return incompleteLine(
      'launch',
      'Launch',
      'kg',
      'Choose a launch vehicle and an orbit to check that the rocket can lift the satellite there.',
    );
  }
  const capacity = capacityAt(vehicle.ssoCapacity, orbit.altitudeKm);
  const needed = chain.feasible ? chain.wetMassKg + scenario.launchAdapterMassKg : Number.POSITIVE_INFINITY;
  const base = {
    id: 'launch' as const,
    label: 'Launch',
    unit: 'kg',
    value: needed,
    limit: capacity,
    details: [
      { label: 'Equipment', value: chain.equipmentMassKg, unit: 'kg' },
      { label: 'Propellant and tanks', value: chain.propellantKg + chain.tankMassKg, unit: 'kg' },
      { label: 'Launch adapter', value: scenario.launchAdapterMassKg, unit: 'kg' },
    ].filter((entry) => entry.value > 0),
  };
  if (capacity <= 0) {
    return {
      ...base,
      margin: -1,
      status: 'fail',
      why: `${vehicle.name} does not reach ${num(orbit.altitudeKm)} km. Choose a lower orbit or another launch.`,
    };
  }
  const margin = 1 - needed / capacity;
  const status = statusFromMargin(margin, MISSION_CONSTANTS.massMargin);
  let why: string;
  if (status === 'fail') {
    why = `${vehicle.name} carries ${num(capacity)} kg to ${num(orbit.altitudeKm)} km and the satellite with its adapter weighs ${num(needed)} kg, ${num(needed - capacity)} kg too much. Lighten it, fly lower or buy a bigger launch.`;
  } else if (status === 'warning') {
    why = `${vehicle.name} carries ${num(capacity)} kg to ${num(orbit.altitudeKm)} km and you need ${num(needed)} kg: only ${percent(margin)} spare for the growth every design goes through.`;
  } else {
    why = `${vehicle.name} carries ${num(capacity)} kg to ${num(orbit.altitudeKm)} km; the satellite and its adapter weigh ${num(needed)} kg, leaving ${percent(margin)} spare.`;
  }
  return { ...base, margin, status, why };
}

/** How long a natural decay takes, in words, for cards and explanations. */
export function lifetimeText(years: number): string {
  if (years >= 59) return 'decades';
  if (years < 1) return duration(years * DAYS_PER_YEAR * 24);
  return `${num(years, 1)} years`;
}
