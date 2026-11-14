/**
 * The hand-flown part of the landing, derived from the design: where it starts, how hard the engine
 * pushes, and how much Δv the tanks hold for it. The braking burn from orbit is flown by the
 * guidance computer; the player takes over for the terminal descent.
 *
 * What the player does comes back as a `LandingInput`, and the simulation decides the rest.
 */
import { getBody } from '@/data/bodies';
import type { DesignEvaluation } from '@/mission/evaluate-design';
import type { LandingInput } from '@/mission/input-log';

export interface DescentPlan {
  /** Catalog id of the body landed on. */
  bodyId: string;
  siteName: string;
  latitudeDeg: number;
  /** East positive. */
  longitudeDeg: number;
  landingJd: number;
  /** Local gravity, m/s². */
  gravity: number;
  /** Main engine acceleration at landing mass, m/s². */
  thrustAcceleration: number;
  /** Δv the scripted pilot spends on the terminal descent, m/s. */
  nominalDeltaV: number;
  /** Δv in the tanks for the terminal descent, reserve included, m/s. */
  availableDeltaV: number;
  /** Height above the terrain, descent rate and ground speed at hand-over, and distance to the target. */
  startAltitudeM: number;
  startDescentRateMS: number;
  startGroundSpeedMS: number;
  startRangeM: number;
  /** A touchdown faster than this vertically, or drifting faster than this sideways, is a crash. */
  maxTouchdownSpeedMS: number;
  maxTouchdownDriftMS: number;
}

/** Null until the design is complete enough to land. */
export function planDescent(evaluation: DesignEvaluation): DescentPlan | null {
  const { resolved, mass } = evaluation;
  const { scenario, site, propulsion, design } = resolved;
  if (!mass?.feasible || !site || !propulsion || design.trajectory.landingJd === null) return null;
  const descent = scenario.descent;
  // The landing system's hover and divert allowance is extra propellant the pilot can spend.
  const allowance = mass.descentDeltaV - descent.deltaVMS;
  return {
    bodyId: scenario.targetBody,
    siteName: site.name,
    latitudeDeg: site.latitudeDeg,
    longitudeDeg: site.longitudeDeg,
    landingJd: design.trajectory.landingJd,
    gravity: getBody(scenario.targetBody).surfaceGravityMS2,
    thrustAcceleration: propulsion.thrustN / mass.dryMassKg,
    nominalDeltaV: descent.terminalDeltaVMS,
    availableDeltaV: descent.terminalDeltaVMS + allowance + mass.reserveDeltaV,
    startAltitudeM: descent.startAltitudeM,
    startDescentRateMS: descent.startDescentRateMS,
    startGroundSpeedMS: descent.startGroundSpeedMS,
    startRangeM: descent.startRangeM,
    maxTouchdownSpeedMS: descent.maxTouchdownSpeedMS,
    maxTouchdownDriftMS: descent.maxTouchdownDriftMS,
  };
}

/** What the hand-flown descent reports back. */
export interface DescentOutcome {
  /** `dry`: the tanks emptied in flight. */
  result: 'landed' | 'crashed' | 'dry';
  /** Δv spent in the terminal descent, m/s. */
  deltaVUsed: number;
  /** Distance from the target at touchdown, m. */
  accuracyM: number;
  /** Speed at ground contact, m/s. */
  touchdownSpeedMS: number;
}

/** Converts a flown descent into the simulation's landing input. */
export function landingInputFromDescent(
  plan: DescentPlan,
  evaluation: DesignEvaluation,
  outcome: DescentOutcome,
): LandingInput {
  const planned = evaluation.mass?.descentDeltaV ?? 1;
  // Braking burn as planned, plus what the pilot actually used below hand-over.
  const braking = planned - (plan.availableDeltaV - (evaluation.mass?.reserveDeltaV ?? 0));
  return {
    descentDeltaVFactor: (braking + outcome.deltaVUsed) / planned,
    accuracyM: outcome.accuracyM,
    crashSpeedMS: outcome.result === 'landed' ? null : outcome.touchdownSpeedMS,
  };
}
