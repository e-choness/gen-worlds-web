/** Cross-scenario constants and difficulty tiers (source and units in `mission_constants.json`). */
import { camelize } from '@/data/camelize';
import raw from '@/data/mission_constants.json';

export type TierId = 'cadet' | 'engineer' | 'director';

/** Tiers in ascending order: a part with `minTier` X is offered at X and above. */
export const TIER_ORDER: readonly TierId[] = ['cadet', 'engineer', 'director'];

export interface MarginThresholds {
  /** Margin at or above this is healthy. */
  target: number;
  /** Margin below this is a warning; below zero is a failure. */
  warning: number;
}

export interface Tier {
  id: TierId;
  name: string;
  /** Multiplies the scenario's budget cap. */
  budgetFactor: number;
  /** Multiplies every event probability. */
  eventRateFactor: number;
  /** Multiplies the final score. */
  scoreFactor: number;
  summary: string;
}

export interface GroundStation {
  id: string;
  name: string;
  antennaDiameterM: number;
  summary: string;
}

export interface MissionConstants {
  solarConstantWM2: number;
  massMargin: MarginThresholds;
  powerMargin: MarginThresholds;
  deltaVMargin: MarginThresholds;
  /** Share of the estimated cost held back for surprises and counted against the cap. */
  costReserveFraction: number;
  /** Probability above which the schedule line warns. */
  scheduleSlipWarning: number;
  /** Probability of losing the mission above which the risk line warns. */
  missionLossRiskWarning: number;
  simulation: {
    /** Charge (share of usable capacity) at which a shadow sortie is abandoned. */
    batteryReserveFraction: number;
    /** Charge needed before a shadow sortie starts. */
    rechargeFraction: number;
    /** Share of a sortie spent driving in and out rather than working. */
    shadowTransitFraction: number;
    /** Multiplies sortie planning time for a computer that can plan on its own. */
    autonomousPlanningFactor: number;
    /** Chance factor of reaching ice with a drill of that depth. */
    iceFindByDepth: { depthM: number; factor: number }[];
    /** Inputs the fast simulation uses in place of a human crew. */
    scriptedPilot: { descentDeltaVFactor: number; operationsEfficiency: number };
  };
  scoring: {
    sciencePoints: number;
    efficiencyPoints: number;
    marginPoints: number;
    survivalPoints: number;
    coordinationPoints: number;
    /** A role must answer its event within this time for it to count as coordinated, s. */
    coordinationResponseSeconds: number;
    dataLossPenaltyPoints: number;
    /** Share of an objective earned on reaching its threshold. */
    thresholdCredit: number;
    /** How much of the science depends on the data actually reaching Earth (0–1). */
    returnedDataWeight: number;
    /** Science fraction at or above which the mission is a success / a partial success. */
    successScienceFraction: number;
    partialScienceFraction: number;
  };
  /** A redundant slot carries a second unit: its mass and cost scale up, its failure rate down. */
  redundancy: { massFactor: number; costFactor: number; failureFactor: number };
  /** Downlink rate of the reference link; real links scale from it. */
  linkReference: {
    rateBps: number;
    txPowerW: number;
    antennaDiameterM: number;
    distanceAu: number;
    groundAntennaDiameterM: number;
  };
  groundStations: GroundStation[];
  /** Chance that one part at this readiness level arrives late. */
  scheduleRiskByTrl: { trl: number; slipProbability: number }[];
  tiers: Tier[];
}

export const MISSION_CONSTANTS: MissionConstants = camelize<MissionConstants>(raw);

export function getTier(id: TierId): Tier {
  const tier = MISSION_CONSTANTS.tiers.find((candidate) => candidate.id === id);
  if (!tier) throw new Error(`Unknown tier "${id}".`);
  return tier;
}

export function tierAllows(playerTier: TierId, minTier: TierId): boolean {
  return TIER_ORDER.indexOf(playerTier) >= TIER_ORDER.indexOf(minTier);
}

export function getGroundStation(id: string): GroundStation {
  const station = MISSION_CONSTANTS.groundStations.find((candidate) => candidate.id === id);
  if (!station) throw new Error(`Unknown ground station "${id}".`);
  return station;
}
