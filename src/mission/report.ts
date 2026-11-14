// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0 or MIT: see LICENSE.md.
/**
 * The causal debrief: for each thing that went wrong or right, the design decision behind it.
 * Findings are ordered for reading: what ended or limited the mission first, then each objective
 * that fell short, then what the design got right.
 */
import type { PartCategory } from '@/data/parts';
import type { DesignEvaluation } from '@/mission/evaluate-design';
import { duration, num, percent } from '@/mission/format';
import type { ObjectiveResult } from '@/mission/scoring';
import type { SurfaceOutcome } from '@/mission/surface-sim';
import type { TimelineEntry } from '@/mission/timeline';

export interface Finding {
  tone: 'good' | 'bad';
  title: string;
  /** Cause → effect in plain language, shown verbatim. */
  detail: string;
  /** The design area to revisit (or that deserves the credit). */
  slot: PartCategory | 'trajectory' | null;
}

export interface ReportInput {
  /** Evaluation of the design as flown. */
  evaluation: DesignEvaluation;
  surface: SurfaceOutcome | null;
  objectives: readonly ObjectiveResult[];
  timeline: readonly TimelineEntry[];
  /** Mission day of touchdown. */
  landingDay: number;
  /** Extra drive caused by the landing error, km. */
  extraDriveKm: number;
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function endFinding(input: ReportInput, surface: SurfaceOutcome): Finding | null {
  const { evaluation, landingDay } = input;
  const { resolved, power, budgets } = evaluation;
  const day = num(surface.hoursOperated / 24, 0);
  const opsDay = resolved.scenario.terms.opsDay;
  const thermal = budgets.find((line) => line.id === 'thermal');
  const colder = input.timeline.some(
    (entry) => entry.phase === 'surface' && entry.slot === 'thermal' && entry.tone === 'bad',
  );
  switch (surface.end.kind) {
    case 'completed':
      return null;
    case 'froze':
      return {
        tone: 'bad',
        title: `Froze on ${opsDay} ${day}`,
        detail: `Night fell for ${duration(surface.end.darkHours)} and counting. Hibernating, the vehicle drew ${num(power?.hibernationDrainW ?? 0)} W from a battery with ${num(power?.usableBatteryWh ?? 0)} Wh usable, and it ran flat before sunrise.${thermal?.status === 'warning' ? ' The design screen warned about this night before launch.' : ''} ${colder ? ' The ground was also colder than predicted, which made the heaters work harder.' : ''} A landing date in polar summer, a larger battery, better insulation or radioisotope heat would have carried it through.`,
        slot: 'thermal',
      };
    case 'battery_flat':
      return {
        tone: 'bad',
        title: `Battery flat on ${opsDay} ${day}`,
        detail: resolved.scenario.orbit
          ? 'The solar cells could no longer keep the satellite alive, the battery ran flat and it never answered again. More solar area or a lighter load would have kept it going.'
          : `Working in shadow drew ${num(power?.shadowDrainW ?? 0)} W (${num(power?.heaterShadowW ?? 0)} W of it heaters) with nothing to recharge the battery. ${resolved.site?.name ?? 'This site'} needs a power source that does not depend on the Sun.`,
        slot: 'power',
      };
    case 'reentered':
      return {
        tone: 'bad',
        title: `Burned up on ${opsDay} ${day}`,
        detail: `Nothing held the orbit against drag, and the air at ${num(resolved.orbit?.altitudeKm ?? 0)} km is thick enough to bring a satellite like this down in ${num(evaluation.orbit ? evaluation.orbit.naturalLifetimeYears * 365 : 0, 0)} days in a quiet year. A higher orbit, or a thruster to hold this one, keeps it flying.`,
        slot: 'trajectory',
      };
    case 'hardware': {
      const { item } = surface.end;
      const redundantNote = resolved.design.redundant.includes(item.slot as never)
        ? 'Even the backup unit failed: bad luck.'
        : 'A backup unit would have cut this risk tenfold for less than twice the mass and cost.';
      return {
        tone: 'bad',
        title: `${item.part.name} failed on ${opsDay} ${day}`,
        detail: `The mission cannot continue without it (mission day ${num(landingDay + surface.hoursOperated / 24, 0)}). Its failure rate is ${percent(item.failureRatePerYear)} per year. ${redundantNote}`,
        slot: item.slot,
      };
    }
  }
}

function objectiveFinding(
  input: ReportInput,
  surface: SurfaceOutcome,
  result: ObjectiveResult,
): Finding | null {
  if (result.achieved >= 0.999) return null;
  const { resolved, power, data } = input.evaluation;
  const { site, mobility } = resolved;
  const terms = resolved.scenario.terms;
  const shadowed = resolved.scenario.operations.targetInShadow;
  const title = `${result.objective.name}: ${percent(result.achieved)}`;
  const endedEarly = surface.end.kind !== 'completed';
  const totalHours = input.evaluation.visibility?.sunVisible.length ?? 1;
  const early = endedEarly
    ? ` The mission ended on ${resolved.scenario.terms.opsDay} ${num(surface.hoursOperated / 24, 0)}.`
    : '';
  const missing = result.objective.requiresMeasures.filter((tag) => !resolved.measures.has(tag));
  if (missing.length > 0) return { tone: 'bad', title, detail: result.why, slot: 'instrument' };

  switch (result.objective.metric) {
    case 'traverse_km': {
      if (!mobility) {
        return {
          tone: 'bad',
          title,
          detail: `${result.why} The vehicle had no wheels, so the sensor only ever saw the ground it landed on.`,
          slot: 'mobility',
        };
      }
      if (surface.mobilityLostHour !== null) {
        return {
          tone: 'bad',
          title,
          detail: `${result.why} The drive failed on surface day ${num(surface.mobilityLostHour / 24, 0)} and the rover stood still from then on.`,
          slot: 'mobility',
        };
      }
      const asleep = surface.hoursHibernating / totalHours;
      if (asleep > 0.3) {
        return {
          tone: 'bad',
          title,
          detail: `${result.why} The rover spent ${percent(asleep)} of the mission hibernating in darkness.${early} A sunnier site or season, or power that does not need the Sun, gives more driving time.`,
          slot: 'trajectory',
        };
      }
      return {
        tone: 'bad',
        title,
        detail: `${result.why}${early} The ${mobility.name.toLowerCase()} covers ${num(mobility.speedMPerH)} m in an hour of driving${surface.hoursSafeMode > 0 ? `, and ${duration(surface.hoursSafeMode)} were lost in safe mode` : ''}.`,
        slot: 'mobility',
      };
    }
    case 'ice_samples': {
      if (site && site.shadowDistanceKm > 0 && (!mobility || mobility.maxSlopeDeg < site.slopeDeg)) {
        return {
          tone: 'bad',
          title,
          detail: `${result.why} ${capitalise(terms.targetShort)} at ${site.name} lies ${num(site.shadowDistanceKm)} km away over ${num(site.slopeDeg, 0)}° slopes, and the vehicle could not get there.`,
          slot: 'mobility',
        };
      }
      if (surface.reachedIceHour === null) {
        return {
          tone: 'bad',
          title,
          detail: `${result.why} The rover never reached ${terms.targetGround}.${input.extraDriveKm > 0.3 ? ` The landing came down ${num(input.extraDriveKm)} km off target, which the rover then had to drive.` : ''}${early}`,
          slot: input.extraDriveKm > 0.3 ? 'landing' : 'mobility',
        };
      }
      if (shadowed && surface.sortiesStarted === 0 && site && site.shadowDistanceKm > 0) {
        return {
          tone: 'bad',
          title,
          detail: `${result.why} The rover reached the edge of the shadow and never went in: on a full charge the battery lasts ${duration(power?.sortieEnduranceHours ?? 0)} there, with ${num(power?.heaterShadowW ?? 0)} W going to heaters. More battery, better insulation or radioisotope heat opens the cold traps.`,
          slot: 'battery',
        };
      }
      if (shadowed && surface.sortiesAborted > 0 && surface.sortiesAborted >= surface.sortiesStarted / 2) {
        return {
          tone: 'bad',
          title,
          detail: `${result.why} ${num(surface.sortiesAborted, 0)} of ${num(surface.sortiesStarted, 0)} trips into shadow were cut short at the battery reserve: the vehicle drains ${num(power?.shadowDrainW ?? 0)} W in the cold.`,
          slot: 'battery',
        };
      }
      if (surface.samplesTaken > surface.iceSamples) {
        return {
          tone: 'bad',
          title,
          detail: `${result.why} The drill took ${num(surface.samplesTaken, 0)} samples and ${num(surface.samplesTaken - surface.iceSamples, 0)} ${terms.emptySample}. ${terms.findAdvice}`,
          slot: 'trajectory',
        };
      }
      return {
        tone: 'bad',
        title,
        detail: shadowed
          ? `${result.why}${early} There was time for only ${num(surface.sortiesStarted, 0)} trips into shadow between recharges and nights.`
          : `${result.why}${early} The drill took ${num(surface.samplesTaken, 0)} samples in the working hours it had: more daylight power, or power that does not need the Sun, gives it more.`,
        slot: 'power',
      };
    }
    case 'data_returned_gb': {
      if (surface.dataLostGb > 0.05 * Math.max(surface.dataGeneratedGb, 1e-9)) {
        return {
          tone: 'bad',
          title,
          detail: `${result.why} ${num(surface.dataLostGb)} Gb were overwritten or lost before they could be sent: the recorder holds ${num(data?.storageGb ?? 0)} Gb and Earth was out of view for up to ${duration(data?.longestOutageHours ?? 0)}.`,
          slot: 'computer',
        };
      }
      if (surface.dataGeneratedGb < result.objective.target) {
        return {
          tone: 'bad',
          title,
          detail: `${result.why} The instruments only produced ${num(surface.dataGeneratedGb)} Gb in the time they worked.${early}`,
          slot: 'instrument',
        };
      }
      return {
        tone: 'bad',
        title,
        detail: `${result.why} The radio could send about ${num(data?.downlinkGbPerDay ?? 0)} Gb a day, less than the instruments produced.`,
        slot: 'comms',
      };
    }
    case 'context_measures':
      return {
        tone: 'bad',
        title,
        detail: resolved.scenario.orbit
          ? `${result.why} Each instrument beyond the imager adds one.`
          : `${result.why} Cameras, mineral and temperature sensors and radar each add one.`,
        slot: 'instrument',
      };
    case 'area_imaged_mkm2': {
      const returnedShare =
        surface.dataGeneratedGb > 0 ? surface.dataReturnedGb / surface.dataGeneratedGb : 0;
      if (surface.dataGeneratedGb > 0 && returnedShare < 0.7) {
        return {
          tone: 'bad',
          title,
          detail: `${result.why} Only ${percent(returnedShare)} of what the instruments recorded reached the ground: the radio sends about ${num(data?.downlinkGbPerDay ?? 0)} Gb a day and they produce ${num(data?.generatedGbPerDay ?? 0)}. A faster radio turns recorded ground into delivered ground.${early}`,
          slot: 'comms',
        };
      }
      return {
        tone: 'bad',
        title,
        detail: `${result.why}${early} A wider swath covers more ground on every orbit, as long as the detail stays within the requirement at your altitude and the satellite can hold still enough to use it.`,
        slot: 'instrument',
      };
    }
    case 'days_operated':
      return { tone: 'bad', title, detail: `${result.why}${early}`, slot: null };
  }
}

export function buildFindings(input: ReportInput): Finding[] {
  const findings: Finding[] = [];
  const { surface } = input;
  if (surface) {
    const end = endFinding(input, surface);
    if (end) findings.push(end);
    // A vehicle that died almost on arrival has one story to tell, not one per objective.
    const planned = input.evaluation.visibility?.sunVisible.length ?? 0;
    const diedOnArrival = surface.end.kind !== 'completed' && surface.hoursOperated < planned * 0.1;
    if (!diedOnArrival) {
      for (const result of input.objectives) {
        const finding = objectiveFinding(input, surface, result);
        if (finding) findings.push(finding);
      }
    }
  }
  // Credit the design choices that absorbed or softened an event.
  for (const entry of input.timeline) {
    if (entry.mitigated) {
      findings.push({ tone: 'good', title: entry.title, detail: entry.detail, slot: entry.slot });
    }
  }
  if (surface && surface.nightsSurvived > 0) {
    findings.push({
      tone: 'good',
      title: `Survived ${num(surface.nightsSurvived, 0)} night${surface.nightsSurvived === 1 ? '' : 's'}`,
      detail: `The battery and thermal design carried the vehicle through ${duration(input.evaluation.visibility?.longestDarkHours ?? 0)} of darkness at the longest.`,
      slot: 'thermal',
    });
  }
  return findings;
}
