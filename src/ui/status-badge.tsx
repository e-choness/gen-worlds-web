// Gen Worlds © 2026 Echo Yin. PolyForm Noncommercial 1.0.0: see LICENSE.md.
import type { BudgetStatus } from '@/mission/budget-line';
import { TEXT } from '@/ui/text';

/** Shape and word carry the status, so it reads without colour. */
const ICONS: Record<BudgetStatus, string> = { ok: '✓', warning: '▲', fail: '✕', incomplete: '○' };

export interface StatusBadgeProps {
  status: BudgetStatus;
  /** Icon only (the word stays available to screen readers). */
  compact?: boolean;
}

export function StatusBadge({ status, compact = false }: StatusBadgeProps) {
  return (
    <span class="status-badge" data-status={status}>
      <span aria-hidden="true">{ICONS[status]}</span>
      <span class={compact ? 'visually-hidden' : undefined}>{TEXT.status[status]}</span>
    </span>
  );
}
