/**
 * Turns what the mission achieved into objective results and a score. Several designs can win:
 * science dominates, and an unspent budget, healthy margins and survival add to it.
 */
import { MISSION_CONSTANTS } from '@/data/mission-constants';
import type { Objective, ObjectiveMetric } from '@/data/scenarios';
import type { ResolvedDesign } from '@/mission/design';
import { num, percent } from '@/mission/format';
import type { InputLog } from '@/mission/input-log';
import { measureName } from '@/mission/slot-names';

export type MissionMetrics = Record<ObjectiveMetric, number>;

export interface ObjectiveResult {
  objective: Objective;
  value: number;
  /** 0–1 share of the objective earned. */
  achieved: number;
  /** One sentence: what was reached against the target, or why it could not score. */
  why: string;
}

const METRIC_PHRASES: Record<
  ObjectiveMetric,
  (value: number, target: number, resolved: ResolvedDesign) => string
> = {
  traverse_km: (value, target) => `${num(value)} km driven with the sensor running, target ${num(target)} km`,
  ice_samples: (value, target, resolved) =>
    `${num(value, 0)} sample${value === 1 ? '' : 's'} ${resolved.scenario.terms.sampleCount}, target ${num(target, 0)}`,
  data_returned_gb: (value, target) => `${num(value)} Gb received on Earth, target ${num(target)} Gb`,
  context_measures: (value, target) =>
    `${num(value, 0)} kind${value === 1 ? '' : 's'} of context measurement returned, target ${num(target, 0)}`,
};

export function scoreObjectives(resolved: ResolvedDesign, metrics: MissionMetrics): ObjectiveResult[] {
  const credit = MISSION_CONSTANTS.scoring.thresholdCredit;
  return resolved.scenario.objectives.map((objective) => {
    const value = metrics[objective.metric];
    const missing = objective.requiresMeasures.filter((tag) => !resolved.measures.has(tag));
    if (missing.length > 0) {
      return {
        objective,
        value: 0,
        achieved: 0,
        why: `Not attempted: no instrument provided ${missing.map(measureName).join(' and ')}.`,
      };
    }
    const phrase = METRIC_PHRASES[objective.metric](value, objective.target, resolved);
    if (value < objective.threshold) {
      return {
        objective,
        value,
        achieved: 0,
        why: `${phrase}. Below the minimum of ${num(objective.threshold, objective.threshold < 10 ? 0 : 0)} that counts as a result.`,
      };
    }
    const span = objective.target - objective.threshold;
    const achieved = credit + (1 - credit) * Math.min(1, (value - objective.threshold) / span);
    return { objective, value, achieved, why: `${phrase}: ${percent(achieved)} of this objective.` };
  });
}

export type MissionOutcome = 'success' | 'partial' | 'failure';

export interface ScoreBreakdown {
  /** Weighted share of the science objectives achieved, after the returned-data factor (0–1). */
  scienceFraction: number;
  science: number;
  efficiency: number;
  margins: number;
  survival: number;
  coordination: number;
  dataLossPenalty: number;
  tierFactor: number;
  total: number;
  outcome: MissionOutcome;
}

export interface ScoreInput {
  resolved: ResolvedDesign;
  objectives: readonly ObjectiveResult[];
  /** False when the mission was lost before it reached the surface. */
  reachedSurface: boolean;
  survived: boolean;
  dataGeneratedGb: number;
  dataReturnedGb: number;
  dataLostGb: number;
  /** Unspent share of the budget cap at launch. */
  costMargin: number;
  /** True when every budget line was healthy at launch (no warning accepted). */
  allBudgetsHealthy: boolean;
  inputLog: InputLog;
}

export function scoreMission(input: ScoreInput): ScoreBreakdown {
  const scoring = MISSION_CONSTANTS.scoring;
  const tierFactor = input.resolved.tier.scoreFactor;
  if (!input.reachedSurface) {
    return {
      scienceFraction: 0,
      science: 0,
      efficiency: 0,
      margins: 0,
      survival: 0,
      coordination: 0,
      dataLossPenalty: 0,
      tierFactor,
      total: 0,
      outcome: 'failure',
    };
  }
  // Measurements that never reach Earth are worth less: scale everything except the data objective.
  const returnedShare =
    input.dataGeneratedGb > 0 ? Math.min(1, input.dataReturnedGb / input.dataGeneratedGb) : 0;
  const returnedFactor = 1 - scoring.returnedDataWeight + scoring.returnedDataWeight * returnedShare;
  let scienceFraction = 0;
  for (const result of input.objectives) {
    const factor = result.objective.metric === 'data_returned_gb' ? 1 : returnedFactor;
    scienceFraction += result.objective.weight * result.achieved * factor;
  }
  const science = scoring.sciencePoints * scienceFraction;
  // Thrift only counts when the mission delivered: an empty mission that was cheap is still empty.
  const efficiency =
    scoring.efficiencyPoints * Math.max(0, input.costMargin) * Math.min(1, scienceFraction * 2);
  const margins = input.allBudgetsHealthy ? scoring.marginPoints : 0;
  const survival = input.survived ? scoring.survivalPoints : 0;
  const responses = input.inputLog.eventResponses;
  const inTime = responses.filter(
    (response) => response.responseSeconds <= scoring.coordinationResponseSeconds,
  );
  const coordination =
    responses.length > 0 ? (scoring.coordinationPoints * inTime.length) / responses.length : 0;
  const lostShare = input.dataGeneratedGb > 0 ? Math.min(1, input.dataLostGb / input.dataGeneratedGb) : 0;
  const dataLossPenalty = scoring.dataLossPenaltyPoints * lostShare;
  const total = Math.max(
    0,
    Math.round((science + efficiency + margins + survival + coordination - dataLossPenalty) * tierFactor),
  );
  const outcome: MissionOutcome =
    scienceFraction >= scoring.successScienceFraction
      ? 'success'
      : scienceFraction >= scoring.partialScienceFraction
        ? 'partial'
        : 'failure';
  return {
    scienceFraction,
    science,
    efficiency,
    margins,
    survival,
    coordination,
    dataLossPenalty,
    tierFactor,
    total,
    outcome,
  };
}
