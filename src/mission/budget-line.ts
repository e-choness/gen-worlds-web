// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0 or MIT: see LICENSE.md.
/** The shape every budget returns: a number, a verdict and the reason in plain language. */
import type { MarginThresholds } from '@/data/mission-constants';
import type { ResourceId } from '@/data/scenarios';

/** `incomplete`: a choice the budget depends on has not been made yet. */
export type BudgetStatus = 'ok' | 'warning' | 'fail' | 'incomplete';

export interface BudgetDetail {
  label: string;
  value: number;
  unit: string;
}

export interface BudgetLine {
  id: ResourceId;
  label: string;
  /** What the design uses or needs. */
  value: number;
  /** What is available, in the same unit; null when the line has no hard limit. */
  limit: number | null;
  unit: string;
  /** Spare share of the limit (0.2 = 20 % spare, negative = over); null when not applicable. */
  margin: number | null;
  status: BudgetStatus;
  /** The consequence and its cause, shown to the player verbatim. */
  why: string;
  /** The terms that add up to `value`, largest decisions first. */
  details: BudgetDetail[];
}

export function statusFromMargin(margin: number, thresholds: MarginThresholds): BudgetStatus {
  if (margin < 0) return 'fail';
  return margin < thresholds.warning ? 'warning' : 'ok';
}

/** A line for a budget that cannot be computed until the player chooses something. */
export function incompleteLine(id: ResourceId, label: string, unit: string, why: string): BudgetLine {
  return { id, label, value: 0, limit: null, unit, margin: null, status: 'incomplete', why, details: [] };
}

const WORST_FIRST: readonly BudgetStatus[] = ['fail', 'incomplete', 'warning', 'ok'];

export function worstStatus(statuses: readonly BudgetStatus[]): BudgetStatus {
  for (const status of WORST_FIRST) if (statuses.includes(status)) return status;
  return 'ok';
}
