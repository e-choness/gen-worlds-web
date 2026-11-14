/**
 * A mission code: a design, and optionally the seed and crew inputs of one flight, packed into a
 * URL-safe string. Because the simulation is deterministic, anyone holding the code can fly the
 * very same mission and get the very same score, which is what makes scores comparable and
 * leaderboard entries checkable.
 */
import { SLOT_IDS, type SlotId } from '@/data/parts';
import { SCENARIOS } from '@/data/scenarios';
import type { MissionDesign } from '@/mission/design';
import type { InputLog } from '@/mission/input-log';

export interface MissionCode {
  design: MissionDesign;
  /** Present when the code describes one flight rather than just a design. */
  seed: number | null;
  inputLog: InputLog | null;
}

const VERSION = 1;
const TIERS = ['cadet', 'engineer', 'director'];
/** Longest code accepted: a full design with a hand-flown log is under 1,500 characters. */
const MAX_LENGTH = 4000;

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(code: string): string {
  const binary = atob(code.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

export function encodeMissionCode(mission: MissionCode): string {
  const { design } = mission;
  const t = design.trajectory;
  return toBase64Url(
    JSON.stringify({
      v: VERSION,
      s: design.scenarioId,
      t: design.tier,
      p: design.slots,
      i: design.instruments,
      r: design.redundant,
      j: [t.launchVehicleId, t.transferId, t.siteId, t.landingJd, t.departureJd ?? null, t.orbitId ?? null],
      n: mission.seed,
      l: mission.inputLog,
    }),
  );
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length < 64 ? value : null;
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function decodeInputLog(raw: unknown): InputLog | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const log = raw as Record<string, unknown>;
  const landing = log.landing as Record<string, unknown> | null | undefined;
  const responses = Array.isArray(log.eventResponses) ? log.eventResponses.slice(0, 64) : [];
  return {
    landing:
      landing && finite(landing.descentDeltaVFactor) !== null && finite(landing.accuracyM) !== null
        ? {
            descentDeltaVFactor: finite(landing.descentDeltaVFactor) ?? 1,
            accuracyM: finite(landing.accuracyM) ?? 0,
            crashSpeedMS: finite(landing.crashSpeedMS),
          }
        : null,
    operationsEfficiency: finite(log.operationsEfficiency),
    eventResponses: responses.flatMap((entry: unknown) => {
      const response = entry as Record<string, unknown> | null;
      const seconds = finite(response?.responseSeconds);
      return seconds === null ? [] : [{ eventId: text(response?.eventId) ?? '', responseSeconds: seconds }];
    }),
  };
}

/** The mission a code describes, or null when the code is damaged, foreign or from an unknown scenario. */
export function decodeMissionCode(code: string): MissionCode | null {
  if (!code || code.length > MAX_LENGTH) return null;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(fromBase64Url(code)) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null || raw.v !== VERSION) return null;
  const scenarioId = text(raw.s);
  const tier = text(raw.t);
  if (!scenarioId || !SCENARIOS.some((scenario) => scenario.id === scenarioId)) return null;
  if (!tier || !TIERS.includes(tier)) return null;
  const slots: Partial<Record<SlotId, string>> = {};
  const rawSlots = (typeof raw.p === 'object' && raw.p !== null ? raw.p : {}) as Record<string, unknown>;
  for (const slot of SLOT_IDS) {
    const part = text(rawSlots[slot]);
    if (part) slots[slot] = part;
  }
  const list = (value: unknown): string[] =>
    Array.isArray(value) ? value.flatMap((entry) => text(entry) ?? []).slice(0, 16) : [];
  const trajectory = Array.isArray(raw.j) ? raw.j : [];
  return {
    design: {
      scenarioId,
      tier: tier as MissionDesign['tier'],
      slots,
      instruments: list(raw.i),
      redundant: list(raw.r).filter((slot): slot is SlotId => (SLOT_IDS as readonly string[]).includes(slot)),
      trajectory: {
        launchVehicleId: text(trajectory[0]),
        transferId: text(trajectory[1]),
        siteId: text(trajectory[2]),
        landingJd: finite(trajectory[3]),
        departureJd: finite(trajectory[4]),
        orbitId: text(trajectory[5]),
      },
    },
    seed: finite(raw.n),
    inputLog: decodeInputLog(raw.l),
  };
}
