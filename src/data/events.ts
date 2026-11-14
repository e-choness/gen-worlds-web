// Gen Worlds © 2026 Echo Yin. PolyForm Noncommercial 1.0.0: see LICENSE.md.
/** Random mission events (source, units and effect kinds in `events_catalog.json`). */
import { camelize, indexById } from '@/data/camelize';
import raw from '@/data/events_catalog.json';
import type { PartCategory } from '@/data/parts';

/** `any_flight` covers cruise and surface operations. */
export type EventPhase = 'development' | 'cruise' | 'landing' | 'surface' | 'any_flight';

/** Co-op role that answers the event. */
export type EventRole = 'director' | 'engineer' | 'science' | 'comms';

export type EventEffectKind =
  | 'lose_days'
  | 'lose_data_fraction'
  | 'power_loss_fraction'
  | 'budget_cut_fraction'
  | 'slip_lunar_months'
  | 'disable_slot'
  | 'landing_risk_factor'
  | 'heater_demand_factor'
  | 'drag_factor'
  | 'mission_loss';

/**
 * A test on the design. `slot` names the part category it looks at; `property` is a part field in
 * snake_case, a part id or a power kind, depending on `kind`; `value` is the numeric threshold.
 */
export interface DesignCondition {
  kind:
    | 'slot_property_true'
    | 'slot_property_at_least'
    | 'has_part'
    | 'has_power_kind'
    | 'redundant'
    | 'cost_margin_at_least';
  slot: PartCategory | '';
  property: string;
  value: number;
}

export interface EventMitigation {
  condition: DesignCondition;
  probabilityFactor: number;
  magnitudeFactor: number;
  /** Shown verbatim in the debrief when this mitigation applied. */
  why: string;
}

export interface MissionEvent {
  id: string;
  name: string;
  phase: EventPhase;
  role: EventRole;
  /** Chance of happening once in its phase (0 when `ratePerDay` is used instead). */
  probability: number;
  ratePerDay: number;
  effect: { kind: EventEffectKind; magnitude: number; slot: PartCategory | '' };
  description: string;
  /** Shown verbatim in the debrief when nothing in the design softened the event. */
  unmitigatedWhy: string;
  mitigations: EventMitigation[];
}

export const EVENTS: readonly MissionEvent[] = camelize<MissionEvent[]>(raw.events);

const BY_ID = indexById(EVENTS, 'event');

export function getEvent(id: string): MissionEvent {
  const event = BY_ID.get(id);
  if (!event) throw new Error(`Unknown event "${id}".`);
  return event;
}
