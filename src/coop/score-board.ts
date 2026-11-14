// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
/**
 * The global leaderboard, behind an interface like the rest of the network. An entry carries the
 * mission code of the flight, so every client re-simulates it and trusts only what it computes.
 */
import type { Disposable } from '@/core/disposable';

export interface ScoreEntry {
  /** Display name chosen by the player. */
  name: string;
  /** The score the submitter claims; shown only if re-simulating `code` gives the same. */
  score: number;
  scenario: string;
  seed: number;
  /** ISO date of the daily mission this flight belongs to, or null. */
  daily: string | null;
  /** Mission code with seed and input log (see `mission/mission-code`). */
  code: string;
  /** Unix time, ms. */
  at: number;
}

export interface ScoreBoard extends Disposable {
  submit(entry: ScoreEntry): Promise<void>;
  /** The highest claimed scores across all scenarios, best first. */
  top(limit: number): Promise<ScoreEntry[]>;
}
