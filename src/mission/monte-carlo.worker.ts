// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
/// <reference lib="webworker" />
/**
 * Worker entry for the Monte Carlo runs, so hundreds of simulated missions never block the UI.
 * One request in, one response out; errors come back as a message the UI can show.
 */
import type { MissionDesign } from '@/mission/design';
import { type MonteCarloSummary, runMonteCarlo } from '@/mission/monte-carlo';

export interface MonteCarloRequest {
  requestId: number;
  design: MissionDesign;
  runs: number;
  seed: number;
}

export type MonteCarloResponse =
  | { requestId: number; ok: true; summary: MonteCarloSummary }
  | { requestId: number; ok: false; error: string };

self.onmessage = (message: MessageEvent<MonteCarloRequest>): void => {
  const { requestId, design, runs, seed } = message.data;
  let response: MonteCarloResponse;
  try {
    response = { requestId, ok: true, summary: runMonteCarlo(design, runs, seed) };
  } catch (error) {
    response = { requestId, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  self.postMessage(response);
};
