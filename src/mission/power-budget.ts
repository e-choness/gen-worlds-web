/**
 * Power and thermal: what the vehicle generates and draws while it works, and how long its battery
 * carries it through shadow and night. On the lunar pole these two lines decide the mission.
 */
import { MISSION_CONSTANTS } from '@/data/mission-constants';
import { type BudgetLine, incompleteLine, statusFromMargin } from '@/mission/budget-line';
import type { ResolvedDesign } from '@/mission/design';
import { duration, num, percent } from '@/mission/format';
import type { MassChain } from '@/mission/mass-budget';
import type { SiteVisibility } from '@/mission/site-visibility';

export interface PowerModel {
  /** Solar output while the Sun is visible, W (0 for a radioisotope generator). */
  solarLitW: number;
  /** Radioisotope output, W, available all the time. */
  rtgW: number;
  /** Always-on loads while awake (attitude control, computer, thermal control), W. */
  baseLoadW: number;
  /** Extra draw while driving / while instruments run / while transmitting, W. */
  driveLoadW: number;
  scienceLoadW: number;
  commsLoadW: number;
  /** Time-averaged load over a working day, W. */
  averageLoadW: number;
  /** Heater draw in shadow after insulation and radioisotope heat, W. */
  heaterShadowW: number;
  /** Net battery drain while working in shadow, W (≤ 0 means it can stay indefinitely). */
  shadowDrainW: number;
  /** Net battery drain while hibernating through a night, W. */
  hibernationDrainW: number;
  usableBatteryWh: number;
  /** How long the battery lasts working in shadow / hibernating, hours (Infinity when no drain). */
  sortieEnduranceHours: number;
  nightSurvivalHours: number;
}

/** Null until a power source, battery and thermal design are chosen. */
export function computePowerModel(resolved: ResolvedDesign, chain: MassChain | null): PowerModel | null {
  const { power, battery, thermal, scenario } = resolved;
  if (!power || !battery || !thermal) return null;
  const env = scenario.environment;
  const ops = scenario.operations;

  let solarLitW = 0;
  let rtgW = 0;
  let wasteHeatW = 0;
  if (power.powerKind === 'solar') {
    const mounting = env.mountingFactors.find((entry) => entry.mounting === power.mounting)?.factor ?? 0;
    const irradiance = MISSION_CONSTANTS.solarConstantWM2 / env.solarDistanceAu ** 2;
    solarLitW = irradiance * power.efficiency * power.areaM2 * mounting;
  } else {
    rtgW = power.powerBolW;
    wasteHeatW = power.wasteHeatW;
  }

  const baseLoadW =
    (resolved.adcs?.powerW ?? 0) + (resolved.computer?.powerW ?? 0) + thermal.powerW + power.powerW;
  const driveLoadW = resolved.mobility?.powerW ?? 0;
  const scienceLoadW = resolved.instruments.reduce((sum, instrument) => sum + instrument.powerW, 0);
  const commsLoadW = resolved.comms?.powerW ?? 0;
  const averageLoadW =
    baseLoadW +
    driveLoadW * ops.driveFraction +
    scienceLoadW * ops.scienceFraction +
    commsLoadW * ops.commsFraction;

  // Heat leaks through the surface, which grows as mass^(2/3).
  const dryMassKg = chain?.feasible ? chain.dryMassKg : env.heaterReferenceMassKg;
  const sizeFactor = (dryMassKg / env.heaterReferenceMassKg) ** (2 / 3);
  const demand = env.heaterDemandShadowW * sizeFactor * thermal.heatLeakFactor;
  const freeHeat = thermal.radioisotopeHeatW + wasteHeatW;
  const heaterShadowW = Math.max(0, demand - freeHeat);
  const survivalHeaterW = Math.max(0, demand * env.survivalHeaterFraction - freeHeat);

  const usableBatteryWh = battery.capacityWh * battery.depthOfDischarge;
  const shadowDrainW = averageLoadW + heaterShadowW - rtgW;
  const hibernationDrainW = env.hibernationLoadW + survivalHeaterW - rtgW;
  const hours = (drain: number): number => (drain > 0 ? usableBatteryWh / drain : Number.POSITIVE_INFINITY);
  return {
    solarLitW,
    rtgW,
    baseLoadW,
    driveLoadW,
    scienceLoadW,
    commsLoadW,
    averageLoadW,
    heaterShadowW,
    shadowDrainW,
    hibernationDrainW,
    usableBatteryWh,
    sortieEnduranceHours: hours(shadowDrainW),
    nightSurvivalHours: hours(hibernationDrainW),
  };
}

/** Generation against the average working load. */
export function powerLine(resolved: ResolvedDesign, model: PowerModel | null): BudgetLine {
  const { power } = resolved;
  if (!model || !power) {
    return incompleteLine(
      'power',
      'Power',
      'W',
      'Choose a power source, a battery and a thermal design to see the power balance.',
    );
  }
  const generation = model.solarLitW + model.rtgW;
  const margin = generation > 0 ? 1 - model.averageLoadW / generation : -1;
  const status = statusFromMargin(margin, MISSION_CONSTANTS.powerMargin);
  const ops = resolved.scenario.operations;
  const details = [
    { label: 'Always-on systems', value: model.baseLoadW, unit: 'W' },
    { label: 'Instruments (average)', value: model.scienceLoadW * ops.scienceFraction, unit: 'W' },
    { label: 'Driving (average)', value: model.driveLoadW * ops.driveFraction, unit: 'W' },
    { label: 'Transmitting (average)', value: model.commsLoadW * ops.commsFraction, unit: 'W' },
  ].sort((a, b) => b.value - a.value);
  const source =
    power.powerKind === 'solar'
      ? `The ${power.name.toLowerCase()} gives ${num(generation)} W in sunlight here`
      : `The generator gives a steady ${num(generation)} W`;
  let why: string;
  if (status === 'fail') {
    const mountingNote =
      power.powerKind === 'solar' && power.mounting === 'body'
        ? ' Panels that face the sky catch almost nothing from a Sun on the horizon.'
        : '';
    why = `${source}, and a working day draws ${num(model.averageLoadW)} W on average: ${num(model.averageLoadW - generation)} W short.${mountingNote} The largest load is ${details[0].label.toLowerCase()} at ${num(details[0].value)} W.`;
  } else if (status === 'warning') {
    why = `${source} against an average draw of ${num(model.averageLoadW)} W: only ${percent(margin)} spare. Dust or an ageing array would push it into deficit.`;
  } else {
    why = `${source} against an average draw of ${num(model.averageLoadW)} W, leaving ${percent(margin)} spare to recharge the battery.`;
  }
  return {
    id: 'power',
    label: 'Power',
    value: model.averageLoadW,
    limit: generation,
    unit: 'W',
    margin,
    status,
    why,
    details,
  };
}

/** How long the vehicle lasts without sunlight against how long it has to. */
export function thermalLine(
  resolved: ResolvedDesign,
  model: PowerModel | null,
  visibility: SiteVisibility | null,
): BudgetLine {
  const { site, scenario } = resolved;
  if (!model || !site || !visibility) {
    return incompleteLine(
      'thermal',
      'Shadow and night',
      'h',
      'Choose a landing site and date to see how long the darkness lasts there.',
    );
  }
  const ops = scenario.operations;
  const longestDark = visibility.longestDarkHours;
  const survives = model.nightSurvivalHours >= longestDark;
  const details = [
    { label: 'Heaters in shadow', value: model.heaterShadowW, unit: 'W' },
    { label: 'Usable battery', value: model.usableBatteryWh, unit: 'Wh' },
    { label: 'Working time in shadow', value: Math.min(model.sortieEnduranceHours, 9999), unit: 'h' },
  ];
  const base = {
    id: 'thermal' as const,
    label: 'Shadow and night',
    unit: 'h',
    value: Math.min(model.nightSurvivalHours, 9999),
    limit: longestDark,
    margin: longestDark > 0 ? Math.min(model.nightSurvivalHours / longestDark - 1, 9.99) : 9.99,
    details,
  };

  if (visibility.sunFraction === 0) {
    if (model.shadowDrainW <= 0) {
      return {
        ...base,
        status: 'ok',
        why: `${site.name} never sees the Sun, and it does not matter: the generator powers the vehicle and its waste heat keeps it warm indefinitely.`,
      };
    }
    return {
      ...base,
      margin: -1,
      status: 'fail',
      why: `${site.name} never sees the Sun. The battery would run the vehicle for ${duration(model.sortieEnduranceHours)} and could never be recharged. Only a radioisotope generator that covers the whole load works here.`,
    };
  }

  const needsSorties = site.shadowDistanceKm > 0;
  const sortieOk = !needsSorties || model.sortieEnduranceHours >= ops.shadowSortieHours;
  if (survives && sortieOk) {
    return {
      ...base,
      status: 'ok',
      why:
        longestDark === 0
          ? `The Sun stays above the horizon at ${site.name} for the whole mission, and the battery covers ${duration(model.sortieEnduranceHours)} of work in shadowed craters.`
          : `The longest darkness at ${site.name} in this period is ${duration(longestDark)}. Hibernating, the vehicle lasts ${duration(model.nightSurvivalHours)}, and it can work ${duration(model.sortieEnduranceHours)} in shadow on one charge.`,
    };
  }
  if (!sortieOk) {
    return {
      ...base,
      status: 'warning',
      why: `A trip into the shadowed ground takes about ${duration(ops.shadowSortieHours)} and the battery lasts ${duration(model.sortieEnduranceHours)} there (${num(model.shadowDrainW)} W drain, ${num(model.heaterShadowW)} W of it heaters). The vehicle cannot reach the ice and return: add battery, insulation or radioisotope heat.`,
    };
  }
  const day = Math.floor(visibility.hoursToFirstLongNight / 24);
  const ending =
    day < 1
      ? 'You would land in darkness and never wake up'
      : `The mission would end around day ${num(day, 0)}`;
  return {
    ...base,
    status: 'warning',
    why: `Darkness at ${site.name} lasts up to ${duration(longestDark)} in this period, and the hibernating vehicle survives ${duration(model.nightSurvivalHours)} before it freezes. ${ending}. A different landing date, a larger battery, better insulation or radioisotope heat fixes this.`,
  };
}
