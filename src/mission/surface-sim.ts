/**
 * Surface operations, one hour per step: sunlight and Earth visibility from the site's sky, battery
 * in and out, drives, sorties into shadow to drill, data produced and sent home, events and faults.
 *
 * The scripted crew follows one rule set: work when there is power, hibernate when there is not,
 * drive to the ice, and go into shadow only on a charged battery, coming out at the reserve.
 */
import { hashCombine, hashString, Rng } from '@/core/random';
import { MISSION_CONSTANTS } from '@/data/mission-constants';
import type { InstalledPart } from '@/mission/design';
import type { DesignEvaluation } from '@/mission/evaluate-design';
import type { EventOccurrence } from '@/mission/event-roll';
import { duration, num } from '@/mission/format';
import type { TimelineEntry } from '@/mission/timeline';

export interface ScheduledFailure {
  /** Hours after touchdown. */
  hour: number;
  item: InstalledPart;
}

export interface SurfaceInput {
  /** Evaluation of the design as flown (after any descope or slip). All models must be present. */
  evaluation: DesignEvaluation;
  seed: number;
  /** Surface-phase events, with hours counted from touchdown. */
  events: readonly EventOccurrence[];
  failures: readonly ScheduledFailure[];
  /** Crew efficiency, 1 = skilled. */
  efficiency: number;
  /** Extra distance to the ice from an inaccurate landing, km. */
  extraDriveKm: number;
  /** Mission day of touchdown, for timeline entries. */
  landingDay: number;
}

export type SurfaceEnd =
  | { kind: 'completed' }
  | { kind: 'froze'; hour: number; darkHours: number }
  | { kind: 'battery_flat'; hour: number }
  | { kind: 'hardware'; hour: number; item: InstalledPart };

/** What the vehicle was doing in one hour, as stored in `SurfaceTelemetry.mode`. */
export const SURFACE_MODES = ['working', 'hibernating', 'safe_mode', 'in_shadow'] as const;
export type SurfaceMode = (typeof SURFACE_MODES)[number];

/**
 * Hour-by-hour state of the vehicle on the surface, for the mission dashboard. Every array has one
 * entry per hour and `hours` valid entries; index 0 is the hour of touchdown.
 */
export interface SurfaceTelemetry {
  hours: number;
  /** Charge as a fraction of the usable battery, 0–1, at the end of the hour. */
  batteryFraction: Float32Array;
  /** Data waiting on board, Gb. */
  bufferGb: Float32Array;
  /** Data received on Earth so far, Gb. */
  returnedGb: Float32Array;
  /** Distance driven so far, km. */
  traverseKm: Float32Array;
  /** Index into `SURFACE_MODES`. */
  mode: Uint8Array;
  /** 1 when the Sun is above the local horizon at the landing site. */
  sunVisible: Uint8Array;
  /** 1 when Earth is above the local horizon at the landing site. */
  earthVisible: Uint8Array;
}

export interface SurfaceOutcome {
  end: SurfaceEnd;
  telemetry: SurfaceTelemetry;
  hoursOperated: number;
  traverseKm: number;
  /** Drill samples taken, and those in which ice was confirmed. */
  samplesTaken: number;
  iceSamples: number;
  dataGeneratedGb: number;
  dataReturnedGb: number;
  dataLostGb: number;
  nightsSurvived: number;
  hoursHibernating: number;
  hoursSafeMode: number;
  sortiesStarted: number;
  sortiesAborted: number;
  /** Hour the vehicle first reached ice-bearing ground, or null if it never did. */
  reachedIceHour: number | null;
  mobilityLostHour: number | null;
  /** Ids of instruments that failed. */
  failedInstruments: string[];
  timeline: TimelineEntry[];
}

/** Gigabits produced or sent in one hour at one megabit per second. */
const GB_PER_MBPS_HOUR = 3.6;

/** Slots whose failure ends the mission. */
const CRITICAL = new Set(['bus', 'power', 'battery', 'computer', 'comms', 'thermal']);

export function simulateSurface(input: SurfaceInput): SurfaceOutcome {
  const { evaluation, events, failures, efficiency, landingDay } = input;
  const { resolved, power, data, visibility } = evaluation;
  const { site, scenario, mobility, comms } = resolved;
  if (!power || !data || !visibility || !site || !comms) {
    throw new Error('The surface simulation needs a complete design.');
  }
  const ops = scenario.operations;
  const env = scenario.environment;
  const sim = MISSION_CONSTANTS.simulation;
  const iceRng = new Rng(hashCombine(input.seed, hashString('ice')));
  const timeline: TimelineEntry[] = [];
  const note = (
    hour: number,
    tone: TimelineEntry['tone'],
    title: string,
    detail: string,
    slot: TimelineEntry['slot'],
    mitigated = false,
  ): void => {
    timeline.push({ day: landingDay + hour / 24, phase: 'surface', tone, title, mitigated, detail, slot });
  };

  const hours = visibility.sunVisible.length;
  const usable = power.usableBatteryWh;
  const inIce = site.shadowDistanceKm === 0;
  const canReachIce = inIce || (!!mobility && mobility.maxSlopeDeg >= site.slopeDeg);
  const speedKmPerHour = mobility ? (mobility.speedMPerH / 1000) * ops.driveFraction * efficiency : 0;
  const passLimit = Math.min(1, ops.groundPassHoursPerDay / 24 / ops.commsFraction);
  const linkGbPerHour =
    data.linkRateMbps *
    GB_PER_MBPS_HOUR *
    ops.commsFraction *
    (comms.relay ? ops.relayCoverageFraction : passLimit);
  const confirmMeasures = scenario.objectives.find((objective) => objective.metric === 'ice_samples');
  const canConfirm =
    !confirmMeasures || confirmMeasures.requiresMeasures.every((tag) => resolved.measures.has(tag));

  // The crew knows the sky in advance: hours of sunlight left before the next darkness, per hour.
  const sunlightAhead = new Uint16Array(hours);
  for (let hour = hours - 1, run = 0; hour >= 0; hour--) {
    run = visibility.sunVisible[hour] === 1 ? Math.min(run + 1, 65535) : 0;
    sunlightAhead[hour] = run;
  }
  const planningHours =
    ops.sortiePlanningHours * ((resolved.computer?.autonomy ?? 1) >= 2 ? sim.autonomousPlanningFactor : 1);
  let planningLeft = 0;
  const telemetry: SurfaceTelemetry = {
    hours: 0,
    batteryFraction: new Float32Array(hours),
    bufferGb: new Float32Array(hours),
    returnedGb: new Float32Array(hours),
    traverseKm: new Float32Array(hours),
    mode: new Uint8Array(hours),
    sunVisible: visibility.sunVisible,
    earthVisible: visibility.earthVisible,
  };

  let battery = usable;
  let buffer = 0;
  let generated = 0;
  let returned = 0;
  let lost = 0;
  let traverseKm = 0;
  let samplesTaken = 0;
  let iceSamples = 0;
  let drillHours = 0;
  let distanceToIceKm = inIce ? 0 : site.shadowDistanceKm + input.extraDriveKm;
  let reachedIceHour: number | null = inIce ? 0 : null;
  let inSortie = false;
  let sortieHoursLeft = 0;
  let sortiesStarted = 0;
  let sortiesAborted = 0;
  let safeModeHours = 0;
  let hoursSafeMode = 0;
  let hoursHibernating = 0;
  let darkRun = 0;
  let nightsSurvived = 0;
  let heaterFactor = 1;
  let powerLoss = 0;
  let mobilityWorking = !!mobility;
  let mobilityLostHour: number | null = null;
  const failedInstruments = new Set<string>();
  let end: SurfaceEnd = { kind: 'completed' };
  let hoursOperated = hours;
  let eventIndex = 0;
  const pendingEvents = [...events].sort((a, b) => a.hour - b.hour);
  const pendingFailures = [...failures].sort((a, b) => a.hour - b.hour);
  let failureIndex = 0;

  const drillDepth = (): number =>
    resolved.instruments.reduce(
      (depth, instrument) =>
        failedInstruments.has(instrument.id) ? depth : Math.max(depth, instrument.drillDepthM),
      0,
    );
  const iceChance = (): number => {
    const depth = drillDepth();
    let factor = 0;
    for (const entry of sim.iceFindByDepth)
      if (depth >= entry.depthM) factor = Math.max(factor, entry.factor);
    return site.iceQuality * factor;
  };
  const instrumentRate = (): number =>
    resolved.instruments.reduce(
      (sum, instrument) => (failedInstruments.has(instrument.id) ? sum : sum + instrument.dataRateMbps),
      0,
    );

  for (let hour = 0; hour < hours; hour++) {
    // --- events and hardware faults due this hour
    while (eventIndex < pendingEvents.length && pendingEvents[eventIndex].hour <= hour) {
      const occurrence = pendingEvents[eventIndex++];
      const { event, magnitude, mitigation, why } = occurrence;
      const slot = event.effect.slot || null;
      switch (event.effect.kind) {
        case 'lose_days':
          safeModeHours += magnitude * 24;
          break;
        case 'lose_data_fraction':
          lost += buffer * magnitude;
          buffer *= 1 - magnitude;
          break;
        case 'power_loss_fraction':
          powerLoss = 1 - (1 - powerLoss) * (1 - magnitude);
          break;
        case 'heater_demand_factor':
          heaterFactor *= magnitude;
          break;
        case 'disable_slot':
          if (magnitude > 0 && slot === 'mobility' && mobilityWorking) {
            mobilityWorking = false;
            mobilityLostHour = hour;
          }
          break;
        default:
          break;
      }
      note(hour, mitigation ? 'good' : 'bad', event.name, `${event.description} ${why}`, slot, !!mitigation);
    }
    let fatal: InstalledPart | null = null;
    while (failureIndex < pendingFailures.length && pendingFailures[failureIndex].hour <= hour) {
      const { item } = pendingFailures[failureIndex++];
      if (CRITICAL.has(item.slot)) fatal = item;
      else if (item.slot === 'mobility') {
        if (mobilityWorking) {
          mobilityWorking = false;
          mobilityLostHour = hour;
          note(
            hour,
            'bad',
            'Drive failure',
            `The ${item.part.name.toLowerCase()} failed (${num(item.failureRatePerYear * 100, 0)} % chance per year). The rover is now a fixed station.`,
            'mobility',
          );
        }
      } else if (item.slot === 'instrument') {
        failedInstruments.add(item.part.id);
        note(
          hour,
          'bad',
          'Instrument failure',
          `The ${item.part.name.toLowerCase()} stopped working. Its measurements end here.`,
          'instrument',
        );
      }
    }
    if (fatal) {
      end = { kind: 'hardware', hour, item: fatal };
      hoursOperated = hour;
      break;
    }

    // --- this hour's environment
    const lit = visibility.sunVisible[hour] === 1;
    const heater = Math.max(0, power.heaterDemandW * heaterFactor - power.freeHeatW);
    const survivalHeater = Math.max(
      0,
      power.heaterDemandW * heaterFactor * env.survivalHeaterFraction - power.freeHeatW,
    );
    const solar = power.solarLitW * (1 - powerLoss) * (1 - env.dustDegradationPerDay) ** (hour / 24);
    const selfSufficient = power.rtgW >= power.averageLoadW + heater;
    const shadowDrain = power.averageLoadW + heater - power.rtgW;

    let generation = power.rtgW;
    let load: number;
    let working = false;
    let awake = true;
    let hibernating = false;
    let mode: SurfaceMode = 'working';

    if (safeModeHours > 0) {
      safeModeHours--;
      hoursSafeMode++;
      mode = 'safe_mode';
      inSortie = false;
      const sunlit = lit && !inIce;
      if (sunlit) generation += solar;
      load = power.baseLoadW + (sunlit ? 0 : heater);
    } else if (inSortie) {
      working = true;
      mode = 'in_shadow';
      load = power.averageLoadW + heater;
      drillHours += (1 - sim.shadowTransitFraction) * efficiency;
      if (mobilityWorking) traverseKm += speedKmPerHour;
      sortieHoursLeft--;
      const nextBattery = battery + generation - load;
      if (!selfSufficient && nextBattery <= sim.batteryReserveFraction * usable) {
        inSortie = false;
        sortiesAborted++;
        planningLeft = planningHours;
      } else if (sortieHoursLeft <= 0) {
        inSortie = false;
        planningLeft = planningHours;
      }
    } else if (inIce) {
      working = true;
      mode = 'in_shadow';
      load = power.averageLoadW + heater;
      drillHours += ops.scienceFraction * efficiency;
      if (mobilityWorking) traverseKm += speedKmPerHour;
    } else if (!lit && !selfSufficient) {
      awake = false;
      hibernating = true;
      mode = 'hibernating';
      hoursHibernating++;
      load = env.hibernationLoadW + survivalHeater;
    } else {
      working = true;
      if (lit) generation += solar;
      load = power.averageLoadW + (lit ? 0 : heater);
      if (planningLeft > 0) planningLeft--;
      if (mobilityWorking) {
        if (distanceToIceKm > 0 && canReachIce) {
          distanceToIceKm -= speedKmPerHour;
          traverseKm += speedKmPerHour;
          if (distanceToIceKm <= 0) {
            reachedIceHour = hour;
            note(
              hour,
              'good',
              'Reached the shadowed ground',
              `After ${num(traverseKm)} km the rover stands at the edge of permanently shadowed, ice-bearing ground.`,
              'mobility',
            );
          }
        } else if (distanceToIceKm <= 0 && canReachIce && drillDepth() > 0) {
          const charged = battery >= sim.rechargeFraction * usable;
          // A sortie must leave time to work before the battery hits the reserve.
          const reachHours =
            shadowDrain > 0
              ? ((sim.rechargeFraction - sim.batteryReserveFraction) * usable) / shadowDrain
              : Number.POSITIVE_INFINITY;
          // Never go in when night would fall before the battery is full again.
          const surplus = solar - power.averageLoadW;
          const rechargeHours = surplus > 0 ? ((1 - sim.batteryReserveFraction) * usable) / surplus : 0;
          const daylightOk = selfSufficient || sunlightAhead[hour] >= ops.shadowSortieHours + rechargeHours;
          if ((charged || selfSufficient) && reachHours >= 2 && planningLeft <= 0 && daylightOk) {
            inSortie = true;
            sortiesStarted++;
            sortieHoursLeft = ops.shadowSortieHours;
          } else traverseKm += speedKmPerHour * 0.5;
        } else traverseKm += speedKmPerHour;
      }
    }

    // --- drilling results
    while (drillHours >= ops.drillHoursPerSample && drillDepth() > 0) {
      drillHours -= ops.drillHoursPerSample;
      samplesTaken++;
      if (canConfirm && iceRng.chance(iceChance())) {
        iceSamples++;
        if (iceSamples === 1) {
          note(
            hour,
            'good',
            'Water ice confirmed',
            `The first sample with water ice came up from ${num(drillDepth(), 0)} m below ${site.name}.`,
            'instrument',
          );
        }
      }
    }

    // --- data
    if (working) {
      const produced = instrumentRate() * ops.scienceFraction * GB_PER_MBPS_HOUR;
      buffer += produced;
      generated += produced;
    }
    if (awake && safeModeHours === 0) {
      const inView = comms.relay || (visibility.earthVisible[hour] === 1 && !inSortie && !inIce);
      if (inView) {
        const sent = Math.min(buffer, linkGbPerHour);
        buffer -= sent;
        returned += sent;
      }
    }
    if (buffer > data.storageGb) {
      lost += buffer - data.storageGb;
      buffer = data.storageGb;
    }

    // --- energy
    battery = Math.min(usable, battery + generation - load);
    telemetry.batteryFraction[hour] = Math.max(0, battery / usable);
    telemetry.bufferGb[hour] = buffer;
    telemetry.returnedGb[hour] = returned;
    telemetry.traverseKm[hour] = traverseKm;
    telemetry.mode[hour] = SURFACE_MODES.indexOf(mode);
    telemetry.hours = hour + 1;
    if (lit) {
      if (darkRun > 24) {
        nightsSurvived++;
        note(
          hour,
          'good',
          'Survived the night',
          `${duration(darkRun)} without sunlight, and the vehicle woke up with ${num((battery / usable) * 100, 0)} % charge.`,
          'battery',
        );
      }
      darkRun = 0;
    } else darkRun++;
    if (battery <= 0) {
      end = hibernating ? { kind: 'froze', hour, darkHours: darkRun } : { kind: 'battery_flat', hour };
      hoursOperated = hour;
      break;
    }
  }

  return {
    end,
    telemetry,
    hoursOperated,
    traverseKm,
    samplesTaken,
    iceSamples,
    dataGeneratedGb: generated,
    dataReturnedGb: returned,
    dataLostGb: lost,
    nightsSurvived,
    hoursHibernating,
    hoursSafeMode,
    sortiesStarted,
    sortiesAborted,
    reachedIceHour,
    mobilityLostHour,
    failedInstruments: [...failedInstruments],
    timeline,
  };
}
