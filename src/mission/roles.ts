/**
 * Which role answers for which part of the design. The Go/No-Go poll routes issues with it, co-op
 * uses it to decide who may change what, and the flight routes events to the role that must react.
 */
import type { RoleId } from '@/data/mission-constants';
import type { PartCategory } from '@/data/parts';
import type { TimelineEntry } from '@/mission/timeline';

const SLOT_OWNERS: Record<PartCategory | 'trajectory', RoleId> = {
  bus: 'engineer',
  power: 'engineer',
  battery: 'engineer',
  propulsion: 'engineer',
  thermal: 'engineer',
  adcs: 'engineer',
  computer: 'engineer',
  landing: 'engineer',
  mobility: 'science',
  instrument: 'science',
  comms: 'comms',
  trajectory: 'comms',
};

/** The role that owns a slot; anything without a slot (budget, schedule) is the Flight Director's. */
export function roleForSlot(slot: PartCategory | 'trajectory' | null | ''): RoleId {
  return slot ? SLOT_OWNERS[slot] : 'director';
}

/** Trajectory choices split between two roles: Science picks where to land, Comms and Ops the rest. */
export function roleForTrajectoryField(field: string): RoleId {
  return field === 'siteId' ? 'science' : 'comms';
}

/**
 * The role that has to acknowledge a timeline entry when a crew flies together: every event after
 * launch that cost something or that the design absorbed. Null for entries nobody has to answer.
 */
export function routedRole(entry: TimelineEntry): RoleId | null {
  if (entry.phase === 'development' || entry.phase === 'launch') return null;
  if (entry.tone !== 'bad' && !entry.mitigated) return null;
  return roleForSlot(entry.slot);
}
