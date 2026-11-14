// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0 or MIT: see LICENSE.md.
/**
 * What a design change would do to the budgets, before it is made. The design screen runs this for
 * every part on offer so the player sees the trade-off on the card, not after the click.
 */
import type { ResourceId } from '@/data/scenarios';
import type { BudgetStatus } from '@/mission/budget-line';
import type { DesignEvaluation } from '@/mission/evaluate-design';

export interface BudgetChange {
  id: ResourceId;
  label: string;
  /** Change in the line's value (candidate − current), in `unit`. */
  delta: number;
  unit: string;
  from: BudgetStatus;
  to: BudgetStatus;
  /** −1 the status got worse, 1 it improved, 0 unchanged. */
  direction: -1 | 0 | 1;
}

const SEVERITY: Record<BudgetStatus, number> = { ok: 0, warning: 1, incomplete: 2, fail: 3 };

/** Budget lines that change between two evaluations: status changes first, then the largest shifts. */
export function previewChanges(current: DesignEvaluation, candidate: DesignEvaluation): BudgetChange[] {
  const scored: { change: BudgetChange; relative: number }[] = [];
  for (const line of candidate.budgets) {
    const before = current.budgets.find((other) => other.id === line.id);
    if (!before) continue;
    const comparable = Number.isFinite(line.value) && Number.isFinite(before.value);
    const delta = comparable ? line.value - before.value : 0;
    const relative = Math.abs(delta) / Math.max(Math.abs(before.value), Math.abs(line.value), 1);
    const statusShift = SEVERITY[before.status] - SEVERITY[line.status];
    if (statusShift === 0 && relative < 0.005) continue;
    scored.push({
      change: {
        id: line.id,
        label: line.label,
        delta,
        unit: line.unit,
        from: before.status,
        to: line.status,
        direction: statusShift > 0 ? 1 : statusShift < 0 ? -1 : 0,
      },
      relative,
    });
  }
  scored.sort(
    (a, b) => Math.abs(b.change.direction) - Math.abs(a.change.direction) || b.relative - a.relative,
  );
  return scored.map((entry) => entry.change);
}
