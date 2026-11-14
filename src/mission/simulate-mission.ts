// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
/**
 * The mission simulation: `(design, seed, input log) → result`, deterministic and worker-safe.
 * The fast simulation, the Monte Carlo runs, the 3D flight's dashboard and the leaderboard's
 * re-check all call this one function.
 *
 * Phases and their only legal transitions:
 *
 *   development → launch → cruise → landing → surface → complete
 *                    ↓        ↓         ↓
 *                   lost     lost      lost
 *
 * A vehicle that dies on the surface still completes: it keeps what it achieved until then.
 */
import { G0 } from '@/astro/constants';
import { hashCombine, hashString, Rng } from '@/core/random';
import { MISSION_CONSTANTS } from '@/data/mission-constants';
import type { ScenarioTerms } from '@/data/scenarios';
import { installedParts, type MissionDesign } from '@/mission/design';
import { type DesignEvaluation, evaluateDesign } from '@/mission/evaluate-design';
import { rollEvents } from '@/mission/event-roll';
import { money, num, percent } from '@/mission/format';
import { type InputLog, operationsEfficiency, SCRIPTED_INPUT_LOG } from '@/mission/input-log';
import { simulateOrbit } from '@/mission/orbit-sim';
import { buildFindings, type Finding } from '@/mission/report';
import {
  type MissionMetrics,
  type ObjectiveResult,
  type ScoreBreakdown,
  scoreMission,
  scoreObjectives,
} from '@/mission/scoring';
import { type ScheduledFailure, type SurfaceOutcome, simulateSurface } from '@/mission/surface-sim';
import type { TimelineEntry, TimelinePhase } from '@/mission/timeline';

export type SimPhase = 'development' | 'launch' | 'cruise' | 'landing' | 'surface' | 'complete' | 'lost';

export const PHASE_TRANSITIONS: Record<SimPhase, readonly SimPhase[]> = {
  development: ['launch'],
  // A satellite starts work straight from launch: there is no cruise and no landing.
  launch: ['cruise', 'surface', 'lost'],
  cruise: ['landing', 'lost'],
  landing: ['surface', 'lost'],
  surface: ['complete'],
  complete: [],
  lost: [],
};

export interface MissionResult {
  seed: number;
  /** The design that actually flew: after any descope and launch slip. */
  flownDesign: MissionDesign;
  /** Phase in which the mission was lost, or null if it reached the surface. */
  lostIn: TimelinePhase | null;
  /** One sentence that sums the mission up. */
  headline: string;
  metrics: MissionMetrics;
  objectives: ObjectiveResult[];
  score: ScoreBreakdown;
  surface: SurfaceOutcome | null;
  /** Days of surface operations before the mission ended. */
  surfaceDays: number;
  timeline: TimelineEntry[];
  findings: Finding[];
}

const LUNAR_MONTH_DAYS = 29.53;
const HOURS_PER_YEAR = 8766;
/** Slots that end the mission if they fail before touchdown / at any time. */
const FLIGHT_CRITICAL = new Set(['propulsion', 'adcs', 'landing']);
const ALWAYS_CRITICAL = new Set(['bus', 'power', 'battery', 'computer', 'comms', 'thermal']);

const ZERO_METRICS: MissionMetrics = {
  traverse_km: 0,
  ice_samples: 0,
  data_returned_gb: 0,
  context_measures: 0,
  area_imaged_mkm2: 0,
  days_operated: 0,
};

/** @throws when the design is not launchable: check `evaluateDesign(design).launchable` first. */
export function simulateMission(
  design: MissionDesign,
  seed: number,
  inputLog: InputLog = SCRIPTED_INPUT_LOG,
): MissionResult {
  const planned = evaluateDesign(design);
  if (!planned.launchable) throw new Error('This design cannot launch: resolve the failed budgets first.');
  const stream = (name: string): Rng => new Rng(hashCombine(seed, hashString(name)));
  const sim = MISSION_CONSTANTS.simulation;
  const scenario = planned.resolved.scenario;
  const cruiseDays = planned.resolved.transfer?.durationDays ?? 0;
  const surfaceDays = scenario.surfaceDurationDays;
  const allBudgetsHealthy = planned.budgets.every((line) => line.status === 'ok');
  const events = rollEvents({
    resolved: planned.resolved,
    seed,
    costMargin: planned.cost.margin,
    slipProbability: planned.schedule.slipProbability,
    cruiseDays,
    surfaceDays,
  });

  const timeline: TimelineEntry[] = [];
  let phase: SimPhase = 'development';
  const advance = (next: SimPhase): void => {
    if (!PHASE_TRANSITIONS[phase].includes(next)) throw new Error(`Illegal phase change ${phase} → ${next}.`);
    phase = next;
  };

  // ---- development: budget cuts and late hardware change the design before it flies
  let flown: MissionDesign = design;
  let evaluation: DesignEvaluation = planned;
  let costMargin = planned.cost.margin;
  for (const occurrence of events) {
    if (occurrence.phase !== 'development') continue;
    const { event, magnitude, mitigation, why } = occurrence;
    if (event.effect.kind === 'budget_cut_fraction') {
      const cap = planned.cost.capMusd * (1 - magnitude);
      const removed: string[] = [];
      while (evaluation.cost.totalMusd > cap && flown.instruments.length > 1) {
        const priciest = [...evaluation.resolved.instruments].sort((a, b) => b.costMusd - a.costMusd)[0];
        removed.push(priciest.name.toLowerCase());
        flown = { ...flown, instruments: flown.instruments.filter((id) => id !== priciest.id) };
        evaluation = evaluateDesign(flown);
      }
      costMargin = 1 - evaluation.cost.totalMusd / cap;
      const descope =
        removed.length > 0
          ? ` To get back under ${money(cap)} the project removed the ${removed.join(' and the ')}.`
          : '';
      timeline.push({
        day: -60,
        phase: 'development',
        tone: mitigation ? 'good' : 'bad',
        mitigated: !!mitigation,
        title: event.name,
        detail: `${event.description} ${mitigation ? why : `The cap fell by ${percent(magnitude)}.${descope}`}`,
        slot: removed.length > 0 ? 'instrument' : null,
      });
    } else if (event.effect.kind === 'slip_lunar_months' && flown.trajectory.landingJd !== null) {
      const risky = installedParts(evaluation.resolved).sort((a, b) => a.part.trl - b.part.trl)[0];
      flown = {
        ...flown,
        trajectory: {
          ...flown.trajectory,
          landingJd: flown.trajectory.landingJd + magnitude * LUNAR_MONTH_DAYS,
        },
      };
      evaluation = evaluateDesign(flown);
      timeline.push({
        day: -30,
        phase: 'development',
        tone: 'bad',
        mitigated: false,
        title: event.name,
        detail: `The ${risky.part.name.toLowerCase()} (readiness level ${risky.part.trl} of 9) was not ready. ${why}`,
        slot: risky.slot,
      });
    }
  }
  const { resolved, mass, risk } = evaluation;
  const landingDay = cruiseDays;
  /** Extra distance to the ice from the landing error, km; set at touchdown. */
  let extraDriveKm = 0;

  const finish = (
    lostIn: TimelinePhase | null,
    headline: string,
    surface: SurfaceOutcome | null,
  ): MissionResult => {
    const metrics: MissionMetrics = surface
      ? {
          traverse_km: surface.traverseKm,
          ice_samples: surface.iceSamples,
          data_returned_gb: surface.dataReturnedGb,
          context_measures: surface.dataReturnedGb > 0 ? contextMeasures(evaluation, surface) : 0,
          area_imaged_mkm2: surface.areaImagedMkm2,
          days_operated: surface.hoursOperated / 24,
        }
      : ZERO_METRICS;
    const objectives = scoreObjectives(resolved, metrics);
    const score = scoreMission({
      resolved,
      objectives,
      reachedSurface: surface !== null,
      survived: surface?.end.kind === 'completed',
      dataGeneratedGb: surface?.dataGeneratedGb ?? 0,
      dataReturnedGb: surface?.dataReturnedGb ?? 0,
      dataLostGb: surface?.dataLostGb ?? 0,
      costMargin,
      allBudgetsHealthy,
      inputLog,
    });
    if (surface) timeline.push(...surface.timeline);
    timeline.sort((a, b) => a.day - b.day);
    return {
      seed,
      flownDesign: flown,
      lostIn,
      headline: surface
        ? scenario.orbit
          ? orbitHeadline(score, surface)
          : surfaceHeadline(score, surface, scenario.terms)
        : headline,
      metrics,
      objectives,
      score,
      surface,
      surfaceDays: surface ? surface.hoursOperated / 24 : 0,
      timeline,
      findings: buildFindings({
        evaluation,
        surface,
        objectives,
        timeline,
        landingDay,
        extraDriveKm,
      }),
    };
  };

  // ---- launch
  advance('launch');
  const vehicle = resolved.vehicle;
  if (vehicle && stream('launch').chance(1 - vehicle.reliability)) {
    advance('lost');
    const headline = `${vehicle.name} failed during ascent.`;
    timeline.push({
      day: 0,
      phase: 'launch',
      tone: 'bad',
      mitigated: false,
      title: 'Launch failure',
      detail: `${headline} It succeeds ${percent(vehicle.reliability)} of the time; this was one of the others. A rocket with a longer record lowers this risk.`,
      slot: 'trajectory',
    });
    return finish('launch', headline, null);
  }
  timeline.push({
    day: 0,
    phase: 'launch',
    tone: 'neutral',
    mitigated: false,
    title: 'Launch',
    detail: resolved.orbit
      ? `${vehicle?.name ?? 'The rocket'} released the ${num(mass?.wetMassKg ?? 0)} kg satellite at ${num(resolved.orbit.altitudeKm)} km.`
      : `${vehicle?.name ?? 'The rocket'} put ${num(mass?.wetMassKg ?? 0)} kg onto the ${resolved.transfer?.name.toLowerCase() ?? 'transfer'}.`,
    slot: 'trajectory',
  });

  // ---- a mission flown in orbit goes straight to work
  if (scenario.orbit) {
    advance('surface');
    const failures: ScheduledFailure[] = [];
    for (const item of installedParts(resolved)) {
      if (item.failureRatePerYear <= 0) continue;
      const draw = Math.max(stream(`failure:${item.part.id}`).next(), 1e-12);
      const failHour = (-Math.log(draw) / item.failureRatePerYear) * HOURS_PER_YEAR;
      if (failHour < surfaceDays * 24) failures.push({ hour: failHour, item });
    }
    const outcome = simulateOrbit({
      evaluation,
      events: events.filter((occurrence) => occurrence.phase === 'surface' || occurrence.phase === 'cruise'),
      failures,
      efficiency: operationsEfficiency(inputLog),
    });
    advance('complete');
    return finish(null, '', outcome);
  }

  // ---- cruise: events, and hardware that fails before or after arrival
  advance('cruise');
  for (const occurrence of events) {
    if (occurrence.phase !== 'cruise') continue;
    timeline.push({
      day: occurrence.hour / 24,
      phase: 'cruise',
      tone: occurrence.mitigation ? 'good' : 'bad',
      mitigated: !!occurrence.mitigation,
      title: occurrence.event.name,
      detail: `${occurrence.event.description} ${occurrence.why}`,
      slot: occurrence.event.effect.slot || null,
    });
  }
  const cruiseHours = cruiseDays * 24;
  const surfaceFailures: ScheduledFailure[] = [];
  for (const item of installedParts(resolved)) {
    if (item.failureRatePerYear <= 0) continue;
    const draw = Math.max(stream(`failure:${item.part.id}`).next(), 1e-12);
    const failHour = (-Math.log(draw) / item.failureRatePerYear) * HOURS_PER_YEAR;
    const critical = ALWAYS_CRITICAL.has(item.slot) || FLIGHT_CRITICAL.has(item.slot);
    if (failHour < cruiseHours && critical) {
      advance('lost');
      const headline = `The ${item.part.name.toLowerCase()} failed ${num(failHour / 24, 0)} days into the cruise.`;
      // Cruise events were logged ahead of time: the ones after the loss never happened.
      for (let i = timeline.length - 1; i >= 0; i--) {
        if (timeline[i].phase === 'cruise' && timeline[i].day > failHour / 24) timeline.splice(i, 1);
      }
      timeline.push({
        day: failHour / 24,
        phase: 'cruise',
        tone: 'bad',
        mitigated: false,
        title: 'Hardware failure',
        detail: `${headline} The spacecraft cannot reach ${scenario.terms.destination} without it. Its failure rate is ${percent(item.failureRatePerYear)} per year${resolved.design.redundant.includes(item.slot as never) ? ', even with a backup unit' : '; a backup unit would cut that tenfold'}.`,
        slot: item.slot,
      });
      return finish('cruise', headline, null);
    }
    if (
      failHour >= cruiseHours &&
      failHour < cruiseHours + surfaceDays * 24 &&
      !FLIGHT_CRITICAL.has(item.slot)
    ) {
      surfaceFailures.push({ hour: failHour - cruiseHours, item });
    }
  }

  // ---- landing
  advance('landing');
  const landing = resolved.landing;
  if (!mass || !landing) throw new Error('A launchable design always has a mass chain and a landing system.');
  const flownByHand = inputLog.landing !== null;
  const pilot = inputLog.landing ?? {
    descentDeltaVFactor: sim.scriptedPilot.descentDeltaVFactor,
    accuracyM: landing.landingAccuracyM * (0.3 + 0.7 * stream('accuracy').next()),
    crashSpeedMS: null,
  };
  const descentUsed = mass.descentDeltaV * pilot.descentDeltaVFactor;
  const descentAvailable = mass.descentDeltaV + mass.reserveDeltaV;
  if (descentUsed > descentAvailable) {
    advance('lost');
    const headline = 'The tanks ran dry before touchdown.';
    timeline.push({
      day: landingDay,
      phase: 'landing',
      tone: 'bad',
      mitigated: false,
      title: 'Out of propellant',
      detail: `The descent used ${num(descentUsed)} m/s and the tanks held ${num(descentAvailable)} m/s including the reserve. The vehicle fell the rest of the way.`,
      slot: 'propulsion',
    });
    return finish('landing', headline, null);
  }
  if (pilot.crashSpeedMS !== null) {
    advance('lost');
    const headline = `The lander hit the ground at ${num(pilot.crashSpeedMS)} m/s.`;
    timeline.push({
      day: landingDay,
      phase: 'landing',
      tone: 'bad',
      mitigated: false,
      title: 'Hard landing',
      detail: `${headline} The legs survive about ${num(scenario.descent.maxTouchdownSpeedMS)} m/s. Slow the descent earlier, or let the guidance computer fly it.`,
      slot: 'landing',
    });
    return finish('landing', headline, null);
  }
  let riskFactor = 1;
  for (const occurrence of events) {
    if (occurrence.phase !== 'landing') continue;
    if (occurrence.event.effect.kind === 'landing_risk_factor') riskFactor *= occurrence.magnitude;
    timeline.push({
      day: landingDay,
      phase: 'landing',
      tone: occurrence.mitigation ? 'good' : 'bad',
      mitigated: !!occurrence.mitigation,
      title: occurrence.event.name,
      detail: `${occurrence.event.description} ${occurrence.why}`,
      slot: 'landing',
    });
  }
  // A landing flown by hand succeeded in the 3D flight: only the scripted pilot rolls the risk.
  const crashChance = Math.min(0.95, risk.landingFailure * riskFactor);
  if (!flownByHand && stream('landing').chance(crashChance)) {
    advance('lost');
    const site = resolved.site;
    const headline = `The lander crashed at ${site?.name ?? 'the landing site'}.`;
    timeline.push({
      day: landingDay,
      phase: 'landing',
      tone: 'bad',
      mitigated: false,
      title: 'Crash on landing',
      detail: `${headline} The ${landing.name.toLowerCase()} carried a ${percent(crashChance)} chance of this here${site && site.landingHazardFactor > 1 ? ` (${site.name} multiplies landing risk by ${site.landingHazardFactor})` : ''}. A sensor that sees hazards, or gentler ground, lowers it.`,
      slot: 'landing',
    });
    return finish('landing', headline, null);
  }
  extraDriveKm = pilot.accuracyM / 1000;
  const exhaust = (resolved.propulsion?.ispS ?? 300) * G0;
  const leftoverKg = mass.dryMassKg * (Math.exp((descentAvailable - descentUsed) / exhaust) - 1);
  timeline.push({
    day: landingDay,
    phase: 'landing',
    tone: 'good',
    mitigated: false,
    title: 'Touchdown',
    detail: `Landed ${num(pilot.accuracyM)} m from the target at ${resolved.site?.name ?? 'the site'} with ${num(leftoverKg)} kg of propellant left.${pilot.accuracyM > 500 ? ' That distance is now extra driving before the science starts.' : ''}`,
    slot: 'landing',
  });

  // ---- surface
  advance('surface');
  const surface = simulateSurface({
    evaluation,
    seed,
    events: events.filter((occurrence) => occurrence.phase === 'surface'),
    failures: surfaceFailures,
    efficiency: operationsEfficiency(inputLog),
    extraDriveKm,
    landingDay,
  });
  advance('complete');
  return finish(null, '', surface);
}

/** Kinds of measurement returned beyond those the other objectives already require. */
function contextMeasures(evaluation: DesignEvaluation, surface: SurfaceOutcome): number {
  const { resolved } = evaluation;
  const required = new Set(resolved.scenario.objectives.flatMap((objective) => objective.requiresMeasures));
  const context = new Set<string>();
  for (const instrument of resolved.instruments) {
    if (surface.failedInstruments.includes(instrument.id)) continue;
    for (const tag of instrument.measures) if (!required.has(tag)) context.add(tag);
  }
  return context.size;
}

function orbitHeadline(score: ScoreBreakdown, surface: SurfaceOutcome): string {
  const verdict =
    score.outcome === 'success'
      ? 'Mission success'
      : score.outcome === 'partial'
        ? 'Partial success'
        : 'Mission failed';
  const ending =
    surface.end.kind === 'completed'
      ? 'and was still working at the end of the mission'
      : surface.end.kind === 'reentered'
        ? `before it burned up on day ${num(surface.hoursOperated / 24, 0)}`
        : `before it was lost on day ${num(surface.hoursOperated / 24, 0)}`;
  return `${verdict}: the satellite imaged ${num(surface.areaImagedMkm2)} million km², returned ${num(surface.dataReturnedGb)} Gb ${ending}.`;
}

function surfaceHeadline(score: ScoreBreakdown, surface: SurfaceOutcome, terms: ScenarioTerms): string {
  const ice =
    surface.iceSamples > 0
      ? `${terms.foundIn} ${num(surface.iceSamples, 0)} sample${surface.iceSamples === 1 ? '' : 's'}`
      : terms.noFind;
  const ending =
    surface.end.kind === 'completed'
      ? 'and was still working at the end of the mission'
      : `before it was lost on surface day ${num(surface.hoursOperated / 24, 0)}`;
  const verdict =
    score.outcome === 'success'
      ? 'Mission success'
      : score.outcome === 'partial'
        ? 'Partial success'
        : 'Mission failed';
  return `${verdict}: the ${terms.vehicle} drove ${num(surface.traverseKm)} km, ${ice} and returned ${num(surface.dataReturnedGb)} Gb ${ending}.`;
}
