// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
/**
 * The only things hands-on play feeds into the simulation. Everything else (battery, propellant,
 * data, events) is computed by the simulation, so a flown mission and a fast-simulated one cannot
 * drift apart, and `(design, seed, input log)` always replays to the same result.
 */
import { MISSION_CONSTANTS } from '@/data/mission-constants';

export interface LandingInput {
  /** Descent Δv actually spent, as a multiple of the planned descent (1 = on plan, lower = skilled). */
  descentDeltaVFactor: number;
  /** Distance from the target at touchdown, m. */
  accuracyM: number;
  /** Ground-contact speed of a hand-flown landing that did not survive, m/s; null for a good one. */
  crashSpeedMS: number | null;
}

export interface EventResponse {
  eventId: string;
  /** How long the responsible role took to answer, s. */
  responseSeconds: number;
}

export interface InputLog {
  /** Null when the landing was not flown by hand: the scripted pilot lands. */
  landing: LandingInput | null;
  /** Efficiency of surface operations achieved by the crew (1 = skilled); null for the scripted crew. */
  operationsEfficiency: number | null;
  /** Co-op only: response times that earn the coordination bonus. */
  eventResponses: EventResponse[];
}

/** The log of a mission nobody flew by hand: the fast simulation fills in an average crew. */
export const SCRIPTED_INPUT_LOG: InputLog = { landing: null, operationsEfficiency: null, eventResponses: [] };

export function operationsEfficiency(log: InputLog): number {
  return log.operationsEfficiency ?? MISSION_CONSTANTS.simulation.scriptedPilot.operationsEfficiency;
}
