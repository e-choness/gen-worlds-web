import type { ResourceId } from '@/data/scenarios';
import type { BudgetLine } from '@/mission/budget-line';
import { money, num } from '@/mission/format';
import type { DesignIssue } from '@/mission/validation';
import { StatusBadge } from '@/ui/status-badge';
import { TEXT } from '@/ui/text';

export interface BudgetPanelProps {
  budgets: readonly BudgetLine[];
  issues: readonly DesignIssue[];
  /** Resources the scenario marks as critical: flagged in the list. */
  critical: readonly ResourceId[];
}

function amount(line: BudgetLine): string {
  if (line.status === 'incomplete') return '—';
  if (line.unit === '$M') return `${money(line.value)} / ${money(line.limit ?? 0)}`;
  const value = Number.isFinite(line.value) ? num(line.value) : '∞';
  return line.limit === null ? `${value} ${line.unit}` : `${value} / ${num(line.limit)} ${line.unit}`;
}

/** Fill of the bar: the share of the limit in use, or for endurance lines the share of the need met. */
function fill(line: BudgetLine): number | null {
  if (line.limit === null || line.status === 'incomplete' || !Number.isFinite(line.value)) return null;
  if (line.limit <= 0) return 1;
  return Math.max(0, Math.min(1, line.value / line.limit));
}

/** Every budget with its verdict and its reason, then the rule issues. Updates live with the design. */
export function BudgetPanel({ budgets, issues, critical }: BudgetPanelProps) {
  return (
    <section class="budget-panel" aria-label={TEXT.design.budgets}>
      <h2>{TEXT.design.budgets}</h2>
      <ul class="budget-list">
        {budgets.map((line) => {
          const share = fill(line);
          return (
            <li key={line.id} class="budget-line" data-status={line.status}>
              <div class="budget-head">
                <span class="budget-name">
                  {line.label}
                  {critical.includes(line.id) && <span class="chip">{TEXT.design.critical}</span>}
                </span>
                <span class="budget-amount">{amount(line)}</span>
                <StatusBadge status={line.status} />
              </div>
              {share !== null && (
                <div class="budget-bar" aria-hidden="true">
                  <div style={{ width: `${share * 100}%` }} />
                </div>
              )}
              <p class="budget-why">{line.why}</p>
            </li>
          );
        })}
      </ul>
      {issues.length > 0 && (
        <>
          <h2>{TEXT.design.issues}</h2>
          <ul class="issue-list">
            {issues.map((issue) => (
              <li key={issue.code + issue.message} data-severity={issue.severity}>
                <StatusBadge status={issue.severity === 'error' ? 'fail' : 'warning'} compact />
                <span>{issue.message}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
