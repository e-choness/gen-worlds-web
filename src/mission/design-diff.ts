// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0 or MIT: see LICENSE.md.
/** What changed between two designs, in words: used to compare a rerun with the run before it. */
import { isoDateFromJd } from '@/astro/time';
import { SLOT_IDS } from '@/data/parts';
import { type MissionDesign, resolveDesign } from '@/mission/design';
import { SLOT_NAMES } from '@/mission/slot-names';

export function describeDesignChanges(before: MissionDesign, after: MissionDesign): string[] {
  const a = resolveDesign(before);
  const b = resolveDesign(after);
  const changes: string[] = [];
  for (const slot of SLOT_IDS) {
    const from = a[slot]?.name ?? 'none';
    const to = b[slot]?.name ?? 'none';
    if (from !== to) changes.push(`${SLOT_NAMES[slot]}: ${from} → ${to}`);
    const wasRedundant = before.redundant.includes(slot);
    const isRedundant = after.redundant.includes(slot);
    if (wasRedundant !== isRedundant) {
      changes.push(`${SLOT_NAMES[slot]}: backup unit ${isRedundant ? 'added' : 'removed'}`);
    }
  }
  const added = b.instruments.filter((instrument) => !a.instruments.includes(instrument));
  const removed = a.instruments.filter((instrument) => !b.instruments.includes(instrument));
  if (added.length > 0)
    changes.push(`Added ${added.map((instrument) => instrument.name.toLowerCase()).join(', ')}`);
  if (removed.length > 0) {
    changes.push(`Removed ${removed.map((instrument) => instrument.name.toLowerCase()).join(', ')}`);
  }
  if (a.vehicle?.id !== b.vehicle?.id) {
    changes.push(`Launch vehicle: ${a.vehicle?.name ?? 'none'} → ${b.vehicle?.name ?? 'none'}`);
  }
  if (a.transfer?.id !== b.transfer?.id) {
    changes.push(`Route: ${a.transfer?.name ?? 'none'} → ${b.transfer?.name ?? 'none'}`);
  }
  if (a.site?.id !== b.site?.id) changes.push(`Site: ${a.site?.name ?? 'none'} → ${b.site?.name ?? 'none'}`);
  const fromJd = before.trajectory.landingJd;
  const toJd = after.trajectory.landingJd;
  if (fromJd !== toJd && fromJd !== null && toJd !== null) {
    changes.push(`Landing date: ${isoDateFromJd(fromJd)} → ${isoDateFromJd(toJd)}`);
  }
  if (before.tier !== after.tier) changes.push(`Difficulty: ${a.tier.name} → ${b.tier.name}`);
  return changes;
}
