// Gen Worlds © 2026 Echo Yin. PolyForm Noncommercial 1.0.0: see LICENSE.md.
/**
 * A co-op room: the state a crew shares. It is plain data so any adapter can carry it, and it is
 * changed only through field patches (`design.slots.power`, `votes.science`…) so two players
 * editing different things never overwrite each other.
 */
import { ROLE_IDS, type RoleId } from '@/data/mission-constants';
import type { MissionDesign } from '@/mission/design';
import type { LandingInput } from '@/mission/input-log';
import { emptyVotes, type PollVotes } from '@/mission/poll';

export interface RoomPlayer {
  name: string;
  /** Unix time of the last heartbeat, ms. */
  seenAt: number;
}

export interface TradeRequest {
  from: RoleId;
  to: RoleId;
  text: string;
  /** Unix time, ms. */
  at: number;
  status: 'open' | 'accepted' | 'declined';
}

export interface RoomFlight {
  seed: number;
  /** Null until the landing is decided; `auto` when the guidance computer flew it. */
  landing: LandingInput | 'auto' | null;
  /** Seconds each routed event took to be acknowledged, keyed by its index in the timeline. */
  responses: Record<string, number>;
}

export interface RoomState {
  version: 1;
  code: string;
  /** Unix time, ms. */
  createdAt: number;
  players: Record<string, RoomPlayer>;
  /** Player id per role; a role nobody holds belongs to everyone. */
  roles: Record<RoleId, string | null>;
  design: MissionDesign | null;
  votes: PollVotes;
  requests: Record<string, TradeRequest>;
  flight: RoomFlight | null;
}

/** Marks a field for removal in a patch. */
export const REMOVE = Symbol('remove');

/** Field paths (dot separated) to their new values, or `REMOVE`. */
export type RoomPatch = Record<string, unknown>;

/** Room codes avoid letters and digits that are easy to confuse when read aloud. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 5;

export function newRoomCode(): string {
  const values = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return Array.from(values, (value) => CODE_ALPHABET[value % CODE_ALPHABET.length]).join('');
}

export function normaliseRoomCode(text: string): string {
  return text.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function createRoom(code: string, design: MissionDesign | null, now: number): RoomState {
  const roles = {} as RoomState['roles'];
  for (const id of ROLE_IDS) roles[id] = null;
  return {
    version: 1,
    code,
    createdAt: now,
    players: {},
    roles,
    design,
    votes: emptyVotes(),
    requests: {},
    flight: null,
  };
}

/** Applies a patch to a copy of `state` (the in-memory adapter and tests use it). */
export function applyPatch(state: RoomState, patch: RoomPatch): RoomState {
  const next = structuredClone(state) as unknown as Record<string, unknown>;
  for (const [path, value] of Object.entries(patch)) {
    const keys = path.split('.');
    let target = next;
    for (const key of keys.slice(0, -1)) {
      if (typeof target[key] !== 'object' || target[key] === null) target[key] = {};
      target = target[key] as Record<string, unknown>;
    }
    const last = keys[keys.length - 1];
    if (value === REMOVE) delete target[last];
    else target[last] = structuredClone(value);
  }
  return next as unknown as RoomState;
}

/**
 * The smallest patch that turns design `from` into `to`: one entry per slot or trajectory choice
 * that changed, so simultaneous edits by different roles merge instead of colliding.
 */
export function designPatch(from: MissionDesign | null, to: MissionDesign): RoomPatch {
  if (!from || from.scenarioId !== to.scenarioId) return { design: to };
  const patch: RoomPatch = {};
  if (from.tier !== to.tier) patch['design.tier'] = to.tier;
  const slots = new Set([...Object.keys(from.slots), ...Object.keys(to.slots)]) as Set<
    keyof MissionDesign['slots']
  >;
  for (const slot of slots) {
    if (from.slots[slot] !== to.slots[slot]) patch[`design.slots.${slot}`] = to.slots[slot] ?? REMOVE;
  }
  if (from.instruments.join() !== to.instruments.join()) patch['design.instruments'] = to.instruments;
  if (from.redundant.join() !== to.redundant.join()) patch['design.redundant'] = to.redundant;
  const fields = new Set([...Object.keys(from.trajectory), ...Object.keys(to.trajectory)]) as Set<
    keyof MissionDesign['trajectory']
  >;
  for (const field of fields) {
    if (from.trajectory[field] !== to.trajectory[field]) {
      patch[`design.trajectory.${field}`] = to.trajectory[field] ?? null;
    }
  }
  return patch;
}

/** The roles a set of players holds between them. An unheld role is everyone's. */
export function rolesOf(room: RoomState, playerIds: readonly string[]): RoleId[] {
  return ROLE_IDS.filter((role) => {
    const holder = room.roles[role];
    return holder === null || !(holder in room.players) || playerIds.includes(holder);
  });
}

/** Order-independent equality of plain data: adapters may return keys in any order. */
export function sameData(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a).filter((key) => (a as Record<string, unknown>)[key] !== undefined);
  const keysB = Object.keys(b).filter((key) => (b as Record<string, unknown>)[key] !== undefined);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((key) =>
    sameData((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
}
