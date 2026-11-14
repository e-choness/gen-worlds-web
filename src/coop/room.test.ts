// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
import { describe, expect, it } from 'vitest';
import { applyPatch, createRoom, designPatch, REMOVE, rolesOf, sameData } from '@/coop/room';
import { getScenario } from '@/data/scenarios';
import { createReferenceDesign, type MissionDesign } from '@/mission/design';

function baseline(): MissionDesign {
  return createReferenceDesign(getScenario('lunar_ice_prospector'), 'engineer');
}

describe('co-op room', () => {
  it('patches only the slot that changed', () => {
    const from = baseline();
    const to: MissionDesign = { ...from, slots: { ...from.slots, power: 'rtg_mmrtg' } };

    expect(designPatch(from, to)).toEqual({ 'design.slots.power': 'rtg_mmrtg' });
  });

  it('removes an emptied slot instead of storing nothing in it', () => {
    const from = baseline();
    const slots = { ...from.slots };
    delete slots.mobility;

    expect(designPatch(from, { ...from, slots })).toEqual({ 'design.slots.mobility': REMOVE });
  });

  it('sends the whole design when the scenario changes', () => {
    const to = baseline();

    expect(designPatch(null, to)).toEqual({ design: to });
  });

  it('merges two roles changing different slots at once', () => {
    const start = baseline();
    const room = createRoom('ABCDE', start, 0);
    const engineer = designPatch(start, { ...start, slots: { ...start.slots, battery: 'battery_large' } });
    const comms = designPatch(start, { ...start, slots: { ...start.slots, comms: 'comms_high_gain' } });

    const merged = applyPatch(applyPatch(room, engineer), comms);

    expect(merged.design?.slots.battery).toBe('battery_large');
    expect(merged.design?.slots.comms).toBe('comms_high_gain');
  });

  it('leaves the original room untouched when a patch is applied', () => {
    const room = createRoom('ABCDE', baseline(), 0);

    applyPatch(room, { 'votes.science': { vote: 'go', reason: '' } });

    expect(room.votes.science.vote).toBeNull();
  });

  it('gives a role nobody holds to everyone and a held role to its holder only', () => {
    let room = createRoom('ABCDE', null, 0);
    room = applyPatch(room, {
      'players.a': { name: 'Ada', seenAt: 0 },
      'players.b': { name: 'Bo', seenAt: 0 },
      'roles.engineer': 'a',
    });

    expect(rolesOf(room, ['a'])).toEqual(['director', 'engineer', 'science', 'comms']);
    expect(rolesOf(room, ['b'])).toEqual(['director', 'science', 'comms']);
  });

  it('frees the role of a player who is no longer in the room', () => {
    let room = createRoom('ABCDE', null, 0);
    room = applyPatch(room, { 'players.b': { name: 'Bo', seenAt: 0 }, 'roles.engineer': 'gone' });

    expect(rolesOf(room, ['b'])).toContain('engineer');
  });

  it('compares data without caring about key order', () => {
    expect(sameData({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
    expect(sameData({ a: 1 }, { a: 2 })).toBe(false);
    expect(sameData({ a: 1, b: undefined }, { a: 1 })).toBe(true);
  });
});
