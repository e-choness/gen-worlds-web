// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
/**
 * A satellite's working life, one hour per step: power in sunlight and through eclipse, imaging on
 * the day side, downlink during ground-station passes, drag pulling the orbit down, events and
 * faults. It reports in the same shape as the surface simulation, so scoring, the debrief and the
 * mission dashboard treat a satellite and a rover alike.
 */
import { atmosphereDensity } from '@/astro/planet-orbit';
import { getBody } from '@/data/bodies';
import type { DesignEvaluation } from '@/mission/evaluate-design';
import type { EventOccurrence } from '@/mission/event-roll';
import { num } from '@/mission/format';
import { eclipseLoadW } from '@/mission/orbit-budgets';
import { atmosphereLayers, orbitedBody, orbitGeometry } from '@/mission/orbit-model';
import {
  type ScheduledFailure,
  SURFACE_MODES,
  type SurfaceEnd,
  type SurfaceMode,
  type SurfaceOutcome,
  type SurfaceTelemetry,
} from '@/mission/surface-sim';
import type { TimelineEntry } from '@/mission/timeline';

export interface OrbitInput {
  /** Evaluation of the design as flown. Its orbit, power and data models must be present. */
  evaluation: DesignEvaluation;
  events: readonly EventOccurrence[];
  failures: readonly ScheduledFailure[];
  /** Crew efficiency, 1 = skilled. */
  efficiency: number;
}

const GB_PER_MBPS_HOUR = 3.6;
/** A satellite cannot work without these; a failed thruster or instrument only shrinks the mission. */
const CRITICAL = new Set(['bus', 'power', 'battery', 'computer', 'comms', 'thermal', 'adcs']);
/** Hours without enough power to stay alive before the satellite is given up. */
const POWERLESS_LIMIT_HOURS = 72;
const THRUSTER_DUTY = 0.2;

export function simulateOrbit(input: OrbitInput): SurfaceOutcome {
  const { evaluation, events, failures, efficiency } = input;
  const { resolved, power, data, visibility, orbit } = evaluation;
  const { scenario, comms } = resolved;
  const mission = scenario.orbit;
  if (!power || !data || !visibility || !orbit || !mission || !comms || !resolved.orbit) {
    throw new Error('The orbit simulation needs a complete design.');
  }
  const ops = scenario.operations;
  const bodyData = getBody(scenario.targetBody);
  const body = orbitedBody(bodyData);
  const layers = atmosphereLayers(bodyData);
  const timeline: TimelineEntry[] = [];
  const note = (
    hour: number,
    tone: TimelineEntry['tone'],
    title: string,
    detail: string,
    slot: TimelineEntry['slot'],
    mitigated = false,
  ): void => {
    timeline.push({ day: hour / 24, phase: 'surface', tone, title, mitigated, detail, slot });
  };

  const hours = visibility.sunVisible.length;
  const usable = power.usableBatteryWh;
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

  let altitudeM = resolved.orbit.altitudeKm * 1000;
  let geometry = orbitGeometry(body, mission, altitudeM, resolved.orbit.betaAngleDeg);
  let battery = usable;
  let buffer = 0;
  let generated = 0;
  let returned = 0;
  let lost = 0;
  let imagedKm2 = 0;
  let imagerGenerated = 0;
  let safeModeHours = 0;
  let hoursSafeMode = 0;
  let hoursHibernating = 0;
  let powerlessHours = 0;
  let powerLoss = 0;
  let dragFactor = 1;
  let pointing = true;
  let thruster = !!resolved.propulsion;
  let firstImage = false;
  const failedInstruments = new Set<string>();
  let end: SurfaceEnd = { kind: 'completed' };
  let hoursOperated = hours;
  let eventIndex = 0;
  let failureIndex = 0;
  const pendingEvents = [...events].sort((a, b) => a.hour - b.hour);
  const pendingFailures = [...failures].sort((a, b) => a.hour - b.hour);
  const attitude = resolved.adcs?.pointingClass ?? 0;

  for (let hour = 0; hour < hours; hour++) {
    // --- events and hardware faults due this hour
    while (eventIndex < pendingEvents.length && pendingEvents[eventIndex].hour <= hour) {
      const { event, magnitude, mitigation, why } = pendingEvents[eventIndex++];
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
        case 'drag_factor':
          if (magnitude > 0) dragFactor *= magnitude;
          break;
        case 'disable_slot':
          if (magnitude > 0 && slot === 'adcs') pointing = false;
          break;
        default:
          break;
      }
      note(hour, mitigation ? 'good' : 'bad', event.name, `${event.description} ${why}`, slot, !!mitigation);
    }
    let fatal: ScheduledFailure['item'] | null = null;
    while (failureIndex < pendingFailures.length && pendingFailures[failureIndex].hour <= hour) {
      const { item } = pendingFailures[failureIndex++];
      if (CRITICAL.has(item.slot)) fatal = item;
      else if (item.slot === 'propulsion') {
        thruster = false;
        note(
          hour,
          'bad',
          'Thruster failure',
          `The ${item.part.name.toLowerCase()} stopped working. Nothing holds the orbit against drag any more.`,
          'propulsion',
        );
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

    // --- once a day: drag, and the geometry of the orbit as it is now
    if (hour % 24 === 0 && hour > 0) {
      if (!thruster) {
        const a = body.radius + altitudeM;
        const decayPerSecond =
          (Math.sqrt(body.mu * a) * atmosphereDensity(layers, altitudeM) * dragFactor) /
          orbit.ballisticCoefficient;
        altitudeM -= decayPerSecond * 86400;
        if (altitudeM <= mission.reentryAltitudeKm * 1000) {
          end = { kind: 'reentered', hour };
          hoursOperated = hour;
          note(
            hour,
            'bad',
            'Reentry',
            `Drag brought the orbit down from ${num(resolved.orbit.altitudeKm)} km until the satellite burned up in the atmosphere.`,
            'trajectory',
          );
          break;
        }
      }
      geometry = orbitGeometry(body, mission, altitudeM, resolved.orbit.betaAngleDeg);
    }

    // --- power over this hour (orbit average)
    const sunlit = 1 - geometry.eclipseFraction;
    const solar =
      power.solarLitW * (1 - powerLoss) * (1 - scenario.environment.dustDegradationPerDay) ** (hour / 24);
    const generation = solar * sunlit + power.rtgW;
    const survivalLoad = eclipseLoadW(resolved, power) * geometry.eclipseFraction + power.baseLoadW * sunlit;
    const safe = safeModeHours > 0;
    if (safe) {
      safeModeHours--;
      hoursSafeMode++;
    }
    // A satellite that cannot bridge its eclipse, or whose battery is empty, stops working to recharge.
    const eclipseWh = eclipseLoadW(resolved, power) * geometry.eclipseHours;
    const starved = battery <= 0.05 * usable || eclipseWh > usable;
    const working = !safe && !starved;
    let mode: SurfaceMode = 'working';
    if (safe) mode = 'safe_mode';
    else if (starved) {
      mode = 'hibernating';
      hoursHibernating++;
    }

    let instrumentRate = 0;
    let instrumentLoad = 0;
    let areaRateKm2 = 0;
    if (working) {
      for (const instrument of resolved.instruments) {
        if (failedInstruments.has(instrument.id)) continue;
        // An instrument that needs steadier pointing than the satellite has returns nothing useful.
        const steady = (pointing ? attitude : 0) >= instrument.needsPointingClass;
        if (!steady) continue;
        instrumentRate += instrument.dataRateMbps;
        instrumentLoad += instrument.powerW;
        const scale = geometry.altitudeKm / 500;
        const sharpEnough = instrument.gsdMAt500 * scale <= mission.requiredGsdM;
        if (instrument.swathKmAt500 > 0 && sharpEnough) {
          areaRateKm2 +=
            instrument.swathKmAt500 * scale * geometry.groundSpeedKmS * 3600 * resolved.orbit.imageQuality;
        }
      }
    }
    const duty = ops.scienceFraction * sunlit * efficiency;
    const linked = working && (pointing ? attitude : 0) >= comms.needsPointingClass;
    const load =
      survivalLoad +
      instrumentLoad * duty +
      (linked ? power.commsLoadW * geometry.contactFraction : 0) +
      (thruster ? (resolved.propulsion?.powerW ?? 0) * THRUSTER_DUTY : 0);

    // --- imaging and data
    const produced = instrumentRate * duty * GB_PER_MBPS_HOUR;
    if (produced > 0) {
      buffer += produced;
      generated += produced;
      if (areaRateKm2 > 0) {
        imagedKm2 += areaRateKm2 * duty;
        imagerGenerated += produced;
        if (!firstImage) {
          firstImage = true;
          note(
            hour,
            'good',
            'First light',
            `The satellite took its first images from ${num(geometry.altitudeKm)} km.`,
            'instrument',
          );
        }
      }
    }
    if (linked) {
      const sent = Math.min(buffer, data.linkRateMbps * GB_PER_MBPS_HOUR * geometry.contactFraction);
      buffer -= sent;
      returned += sent;
    }
    if (buffer > data.storageGb) {
      lost += buffer - data.storageGb;
      buffer = data.storageGb;
    }

    // --- energy
    battery = Math.max(0, Math.min(usable, battery + generation - load));
    powerlessHours = generation < survivalLoad && battery <= 0 ? powerlessHours + 1 : 0;
    telemetry.batteryFraction[hour] = usable > 0 ? battery / usable : 0;
    telemetry.bufferGb[hour] = buffer;
    telemetry.returnedGb[hour] = returned;
    telemetry.mode[hour] = SURFACE_MODES.indexOf(mode);
    telemetry.hours = hour + 1;
    if (powerlessHours >= POWERLESS_LIMIT_HOURS) {
      end = { kind: 'battery_flat', hour };
      hoursOperated = hour;
      break;
    }
  }

  // Ground that was imaged but never downlinked was not observed as far as anyone on Earth knows.
  const returnedShare = generated > 0 ? Math.min(1, returned / generated) : 0;
  return {
    end,
    telemetry,
    hoursOperated,
    traverseKm: 0,
    samplesTaken: 0,
    iceSamples: 0,
    areaImagedMkm2: imagerGenerated > 0 ? (imagedKm2 * returnedShare) / 1e6 : 0,
    dataGeneratedGb: generated,
    dataReturnedGb: returned,
    dataLostGb: lost,
    nightsSurvived: 0,
    hoursHibernating,
    hoursSafeMode,
    sortiesStarted: 0,
    sortiesAborted: 0,
    reachedIceHour: null,
    mobilityLostHour: null,
    failedInstruments: [...failedInstruments],
    timeline,
  };
}
