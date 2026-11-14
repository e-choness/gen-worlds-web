// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
/**
 * Decides which random events strike a mission and how hard, before the simulation runs.
 *
 * Each event draws from its own random stream derived from (seed, event id), and the design only
 * moves the thresholds. So with the same seed the same solar storm arrives on the same day whatever
 * you fly: comparing two designs compares the designs, not the dice.
 */
import { hashCombine, hashString, Rng } from '@/core/random';
import { type EventMitigation, getEvent, type MissionEvent } from '@/data/events';
import { conditionHolds } from '@/mission/conditions';
import type { ResolvedDesign } from '@/mission/design';

export type ConcretePhase = 'development' | 'cruise' | 'landing' | 'surface';

export interface EventOccurrence {
  event: MissionEvent;
  phase: ConcretePhase;
  /** Hours after the start of `phase`. */
  hour: number;
  /** Effect magnitude after mitigation (0 = fully absorbed). */
  magnitude: number;
  /** The mitigation that did the most, or null when nothing in the design helped. */
  mitigation: EventMitigation | null;
  /** The explanation for the debrief: the mitigation's, or the event's unmitigated one. */
  why: string;
}

export interface EventRollInput {
  resolved: ResolvedDesign;
  seed: number;
  /** Unspent share of the budget cap. */
  costMargin: number;
  /** Chance of a launch slip from the schedule model: drives events of kind `slip_lunar_months`. */
  slipProbability: number;
  cruiseDays: number;
  surfaceDays: number;
}

/** At most this many strikes of one rate-based event per mission. */
const MAX_REPEATS = 3;

export function rollEvents(input: EventRollInput): EventOccurrence[] {
  const { resolved, seed, costMargin, cruiseDays, surfaceDays } = input;
  const tierFactor = resolved.tier.eventRateFactor;
  const occurrences: EventOccurrence[] = [];

  for (const id of resolved.scenario.events) {
    const event = getEvent(id);
    const rng = new Rng(hashCombine(seed, hashString(event.id)));
    const active = event.mitigations.filter((mitigation) =>
      conditionHolds(mitigation.condition, resolved, costMargin),
    );
    let probabilityFactor = 1;
    let magnitudeFactor = 1;
    let best: EventMitigation | null = null;
    for (const mitigation of active) {
      probabilityFactor *= mitigation.probabilityFactor;
      magnitudeFactor *= mitigation.magnitudeFactor;
      const strength = mitigation.probabilityFactor * mitigation.magnitudeFactor;
      if (!best || strength < best.probabilityFactor * best.magnitudeFactor) best = mitigation;
    }
    // Multiplier effects shrink toward 1 (no change); every other effect shrinks toward 0.
    const isMultiplier =
      event.effect.kind === 'landing_risk_factor' || event.effect.kind === 'heater_demand_factor';
    const magnitude = isMultiplier
      ? 1 + (event.effect.magnitude - 1) * magnitudeFactor
      : event.effect.magnitude * magnitudeFactor;
    // A mitigation only earns the credit when it changed the outcome.
    const credited = magnitudeFactor < 1 ? best : null;
    const why = credited ? credited.why : event.unmitigatedWhy;

    const push = (phase: ConcretePhase, hour: number): void => {
      occurrences.push({ event, phase, hour, magnitude, mitigation: credited, why });
    };
    /** Maps an hour in the event's phase span to the concrete phase it falls in. */
    const place = (hourInSpan: number): void => {
      if (event.phase === 'any_flight') {
        const cruiseHours = cruiseDays * 24;
        if (hourInSpan < cruiseHours) push('cruise', hourInSpan);
        else push('surface', hourInSpan - cruiseHours);
      } else push(event.phase, hourInSpan);
    };
    const spanDays =
      event.phase === 'any_flight'
        ? cruiseDays + surfaceDays
        : event.phase === 'cruise'
          ? cruiseDays
          : event.phase === 'surface'
            ? surfaceDays
            : 0;

    // Always draw the same numbers in the same order, whatever the design, to keep streams aligned.
    const roll = rng.next();
    const when = rng.next();
    if (event.ratePerDay > 0) {
      const rate = event.ratePerDay * tierFactor * probabilityFactor;
      let days = -Math.log(Math.max(roll, 1e-12)) / Math.max(rate, 1e-12);
      for (let repeat = 0; repeat < MAX_REPEATS && rate > 0 && days < spanDays; repeat++) {
        place(days * 24);
        days += -Math.log(Math.max(rng.next(), 1e-12)) / rate;
      }
    } else {
      const base =
        event.effect.kind === 'slip_lunar_months' ? input.slipProbability : event.probability * tierFactor;
      if (roll < base * probabilityFactor) place(when * spanDays * 24);
    }
  }
  return occurrences.sort((a, b) => a.hour - b.hour);
}
