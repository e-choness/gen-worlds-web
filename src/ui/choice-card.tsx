import { money, num } from '@/mission/format';
import type { BudgetChange } from '@/mission/preview';
import { TEXT } from '@/ui/text';

export interface ChoiceStat {
  label: string;
  value: string;
}

export interface ChoiceCardProps {
  title: string;
  /** Small line above the title (provider, coordinates…). */
  eyebrow?: string;
  summary: string;
  stats: readonly ChoiceStat[];
  selected: boolean;
  /** What choosing this option would do to the budgets (ignored when already selected). */
  changes: readonly BudgetChange[];
  autofocus?: boolean;
  /** True when another player owns this choice. */
  disabled?: boolean;
  onChoose: () => void;
}

/** A budget shift as a short label: "Launch +152 kg", "Power → Fail". */
export function changeText(change: BudgetChange): string {
  const sign = change.delta > 0 ? '+' : '−';
  const size = Math.abs(change.delta);
  const amount = change.unit === '$M' ? `${sign}${money(size)}` : `${sign}${num(size)} ${change.unit}`;
  const shown = size > 0 ? ` ${amount}` : '';
  return change.from === change.to
    ? `${change.label}${shown}`
    : `${change.label}${shown} → ${TEXT.status[change.to]}`;
}

/** One selectable option with its numbers, its trade-off in words and its effect on the budgets. */
export function ChoiceCard(props: ChoiceCardProps) {
  const { selected, changes } = props;
  const t = TEXT.design;
  return (
    <button
      type="button"
      class={selected ? 'card part-card selected' : 'card part-card'}
      aria-pressed={selected}
      disabled={props.disabled}
      data-autofocus={props.autofocus ? true : undefined}
      onClick={props.onChoose}
    >
      <span class="part-head">
        <span>
          {props.eyebrow && <span class="eyebrow">{props.eyebrow}</span>}
          <span class="card-title">{props.title}</span>
        </span>
        <span class="part-state">{selected ? TEXT.trajectory.chosen : TEXT.trajectory.choose}</span>
      </span>
      <span class="card-text">{props.summary}</span>
      <span class="part-stats">
        {props.stats.map((stat) => (
          <span key={stat.label}>
            <span class="dim">{stat.label}</span> {stat.value}
          </span>
        ))}
      </span>
      {!selected && (
        <span class="part-effect">
          <span class="dim">{t.effect}</span>
          {changes.length === 0 && <span class="dim">{t.noEffect}</span>}
          {changes.map((change) => (
            <span key={change.id} class="effect-chip" data-direction={change.direction}>
              {changeText(change)}
            </span>
          ))}
        </span>
      )}
    </button>
  );
}
