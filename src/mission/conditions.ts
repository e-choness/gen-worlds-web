// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0 or MIT: see LICENSE.md.
/** Evaluates the design tests that event mitigations are written in (see `DesignCondition`). */
import { camelizeKey } from '@/data/camelize';
import type { DesignCondition } from '@/data/events';
import type { SlotId } from '@/data/parts';
import type { ResolvedDesign } from '@/mission/design';

function partProperty(resolved: ResolvedDesign, slot: DesignCondition['slot'], property: string): unknown {
  if (slot === '' || slot === 'instrument') return undefined;
  const part = resolved[slot] as Record<string, unknown> | undefined;
  return part?.[camelizeKey(property)];
}

/** @param costMargin unspent share of the budget cap, for conditions about financial reserve. */
export function conditionHolds(
  condition: DesignCondition,
  resolved: ResolvedDesign,
  costMargin: number,
): boolean {
  switch (condition.kind) {
    case 'slot_property_true':
      return partProperty(resolved, condition.slot, condition.property) === true;
    case 'slot_property_at_least': {
      const value = partProperty(resolved, condition.slot, condition.property);
      return typeof value === 'number' && value >= condition.value;
    }
    case 'has_part':
      if (condition.slot === 'instrument') {
        return resolved.instruments.some((instrument) => instrument.id === condition.property);
      }
      return condition.slot !== '' && resolved[condition.slot]?.id === condition.property;
    case 'has_power_kind':
      return resolved.power?.powerKind === condition.property;
    case 'redundant':
      return condition.slot !== '' && resolved.design.redundant.includes(condition.slot as SlotId);
    case 'cost_margin_at_least':
      return costMargin >= condition.value;
  }
}
