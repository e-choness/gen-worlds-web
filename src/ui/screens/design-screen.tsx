import { useMemo, useState } from 'preact/hooks';
import { type Part, type PartCategory, SLOT_IDS, type SlotId } from '@/data/parts';
import { availableParts, type MissionDesign } from '@/mission/design';
import { type DesignEvaluation, evaluateDesign } from '@/mission/evaluate-design';
import { type BudgetChange, previewChanges } from '@/mission/preview';
import { roleForSlot } from '@/mission/roles';
import { SLOT_NAMES } from '@/mission/slot-names';
import { BudgetPanel, budgetAmount } from '@/ui/budget-panel';
import { changeText } from '@/ui/choice-card';
import { type CrewView, mayAct, ownedBy } from '@/ui/crew-view';
import { partStats } from '@/ui/part-stats';
import { StatusBadge } from '@/ui/status-badge';
import { SystemIcon } from '@/ui/system-icon';
import { TEXT } from '@/ui/text';
import { Vehicle3d } from '@/ui/vehicle-3d';
import { VehicleDiagram } from '@/ui/vehicle-diagram';

export interface DesignScreenProps {
  evaluation: DesignEvaluation;
  /** Null when playing alone. */
  crew: CrewView | null;
  /** True when the device can draw the vehicle in 3D; otherwise the 2D diagram is shown. */
  canRender3d: boolean;
  onSetSlot: (slot: SlotId, partId: string | null) => void;
  onToggleInstrument: (partId: string) => void;
  onToggleRedundant: (slot: SlotId) => void;
  onLoadReference: () => void;
  onClear: () => void;
  onNext: () => void;
  onBack: () => void;
}

interface Option {
  /** Null is the "leave empty" option of an optional slot. */
  part: Part | null;
  selected: boolean;
  changes: BudgetChange[];
}

/** The hangar: choose a part for every system and watch each choice move the budgets. */
export function DesignScreen(props: DesignScreenProps) {
  const { evaluation } = props;
  const { resolved } = evaluation;
  const { scenario, design } = resolved;
  const slots = SLOT_IDS.filter(
    (slot) => scenario.requiredSlots.includes(slot) || scenario.optionalSlots.includes(slot),
  );
  const categories: PartCategory[] = [...slots, 'instrument'];
  const [category, setCategory] = useState<PartCategory>(categories[0]);
  const t = TEXT.design;

  // Evaluate the design as it would be with each part on offer: the trade-off shows on the card.
  const options = useMemo<Option[]>(() => {
    const preview = (candidate: MissionDesign): BudgetChange[] =>
      previewChanges(evaluation, evaluateDesign(candidate)).slice(0, 4);
    const parts = availableParts(scenario, design.tier, category);
    if (category === 'instrument') {
      return parts.map((part) => {
        const selected = design.instruments.includes(part.id);
        const instruments = selected
          ? design.instruments.filter((id) => id !== part.id)
          : [...design.instruments, part.id];
        return { part, selected, changes: preview({ ...design, instruments }) };
      });
    }
    const slot = category;
    const list: Option[] = parts.map((part) => {
      const selected = design.slots[slot] === part.id;
      return {
        part,
        selected,
        changes: selected ? [] : preview({ ...design, slots: { ...design.slots, [slot]: part.id } }),
      };
    });
    if (scenario.optionalSlots.includes(slot)) {
      const without = { ...design.slots };
      delete without[slot];
      const selected = !design.slots[slot];
      list.unshift({ part: null, selected, changes: selected ? [] : preview({ ...design, slots: without }) });
    }
    return list;
  }, [evaluation, scenario, design, category]);

  const chosenName = (entry: PartCategory): string => {
    if (entry === 'instrument') return `${resolved.instruments.length} ${t.instrumentsCount}`;
    return resolved[entry]?.name ?? t.empty;
  };
  const slotStatus = (entry: PartCategory) => {
    if (entry === 'instrument') return resolved.instruments.length > 0 ? 'ok' : 'incomplete';
    if (resolved[entry]) return 'ok';
    return scenario.requiredSlots.includes(entry) ? 'incomplete' : 'ok';
  };
  // The four numbers under the vehicle: what it weighs and costs, and what this mission lives or dies by.
  const vitalIds = [...new Set(['mass', ...scenario.criticalResources, 'cost', 'power'])].slice(0, 4);
  const vitals = vitalIds.flatMap((id) => evaluation.budgets.filter((line) => line.id === id));
  const isInstrument = category === 'instrument';
  const currentSlot = isInstrument ? null : category;
  const owner = roleForSlot(category);
  const editable = mayAct(props.crew, owner);
  const director = mayAct(props.crew, 'director');

  return (
    <section class="screen wide hangar">
      <nav class="slot-list" aria-label={t.slots}>
        <h2>{t.slots}</h2>
        <ul>
          {categories.map((entry, index) => (
            <li key={entry}>
              <button
                type="button"
                class={entry === category ? 'slot selected' : 'slot'}
                aria-current={entry === category ? 'true' : undefined}
                data-autofocus={index === 0 ? true : undefined}
                onClick={() => setCategory(entry)}
              >
                <SystemIcon system={entry} />
                <span class="slot-name">
                  {SLOT_NAMES[entry]}
                  {entry !== 'instrument' && scenario.optionalSlots.includes(entry) && (
                    <span class="dim"> ({t.optional})</span>
                  )}
                </span>
                <span class="slot-choice">{chosenName(entry)}</span>
                <StatusBadge status={slotStatus(entry)} compact />
              </button>
            </li>
          ))}
        </ul>
        <div class="actions column">
          <button type="button" class="button small" disabled={!director} onClick={props.onLoadReference}>
            {t.loadReference}
          </button>
          <button type="button" class="button small" disabled={!director} onClick={props.onClear}>
            {t.clear}
          </button>
        </div>
      </nav>

      <div class="part-column">
        {props.canRender3d ? (
          <Vehicle3d resolved={resolved} propellantKg={evaluation.mass?.propellantKg ?? null} />
        ) : (
          <VehicleDiagram resolved={resolved} propellantKg={evaluation.mass?.propellantKg ?? null} />
        )}
        <dl class="vitals">
          {vitals.map((line) => (
            <div key={line.id} data-status={line.status}>
              <dt>{line.label}</dt>
              <dd>{budgetAmount(line)}</dd>
            </div>
          ))}
        </dl>
        <h2 class="part-heading">
          <SystemIcon system={category} size={28} />
          {SLOT_NAMES[category]}
        </h2>
        {!editable && <p class="banner owned">{ownedBy(props.crew, owner)}</p>}
        <ul class="part-list">
          {options.map((option) => {
            const { part, selected, changes } = option;
            const choose = (): void => {
              if (isInstrument) {
                if (part) props.onToggleInstrument(part.id);
              } else if (currentSlot) props.onSetSlot(currentSlot, part ? part.id : null);
            };
            return (
              <li key={part?.id ?? 'none'}>
                <button
                  type="button"
                  class={selected ? 'card part-card selected' : 'card part-card'}
                  aria-pressed={selected}
                  disabled={!editable}
                  onClick={choose}
                >
                  <span class="part-head">
                    <span class="card-title">{part?.name ?? t.none}</span>
                    <span class="part-state">
                      {selected ? t.installed : isInstrument ? t.add : t.install}
                    </span>
                  </span>
                  <span class="card-text">{part?.summary ?? t.noneSummary}</span>
                  {part && (
                    <span class="part-stats">
                      {partStats(part).map((stat) => (
                        <span key={stat.label}>
                          <span class="dim">{stat.label}</span> {stat.value}
                        </span>
                      ))}
                    </span>
                  )}
                  {(!selected || isInstrument) && (
                    <span class="part-effect">
                      <span class="dim">{selected ? t.remove : t.effect}</span>
                      {changes.length === 0 && <span class="dim">{t.noEffect}</span>}
                      {changes.map((change) => (
                        <span key={change.id} class="effect-chip" data-direction={change.direction}>
                          {changeText(change)}
                        </span>
                      ))}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
        {currentSlot && resolved[currentSlot] && (
          <label class="check">
            <input
              type="checkbox"
              checked={design.redundant.includes(currentSlot)}
              disabled={!editable}
              onChange={() => props.onToggleRedundant(currentSlot)}
            />
            <span>
              {t.redundancy} <span class="dim">{t.redundancyNote}</span>
            </span>
          </label>
        )}
        <div class="actions">
          <button type="button" class="button" onClick={props.onBack}>
            {TEXT.nav.back}
          </button>
          <button type="button" class="button primary" onClick={props.onNext}>
            {t.next}
          </button>
        </div>
      </div>

      <BudgetPanel
        budgets={evaluation.budgets}
        issues={evaluation.issues.filter((issue) => issue.slot !== 'trajectory')}
        critical={scenario.criticalResources}
      />
    </section>
  );
}
