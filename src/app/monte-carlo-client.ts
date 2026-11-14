// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
/**
 * Runs Monte Carlo forecasts in a worker so hundreds of simulated missions never block the UI.
 * Owns the worker; only the latest request's answer is delivered.
 */
import type { Disposable } from '@/core/disposable';
import type { MissionDesign } from '@/mission/design';
import { type MonteCarloSummary, runMonteCarlo } from '@/mission/monte-carlo';
import type { MonteCarloRequest, MonteCarloResponse } from '@/mission/monte-carlo.worker';

export class MonteCarloClient implements Disposable {
  private worker: Worker | null = null;
  private nextId = 1;
  private pending: {
    id: number;
    resolve: (summary: MonteCarloSummary) => void;
    reject: (error: Error) => void;
  } | null = null;

  private ensureWorker(): Worker | null {
    if (this.worker) return this.worker;
    try {
      this.worker = new Worker(new URL('../mission/monte-carlo.worker.ts', import.meta.url), {
        type: 'module',
      });
    } catch {
      // No worker support (or a blocked worker script): fall back to running on the main thread.
      return null;
    }
    this.worker.onmessage = (message: MessageEvent<MonteCarloResponse>): void => {
      const response = message.data;
      const pending = this.pending;
      if (!pending || pending.id !== response.requestId) return;
      this.pending = null;
      if (response.ok) pending.resolve(response.summary);
      else pending.reject(new Error(response.error));
    };
    this.worker.onerror = (event): void => {
      this.pending?.reject(new Error(event.message || 'The forecast worker failed.'));
      this.pending = null;
    };
    return this.worker;
  }

  /** Forecast for a launchable design. A newer call supersedes one still running. */
  run(design: MissionDesign, runs: number, seed: number): Promise<MonteCarloSummary> {
    // The superseded request simply never resolves; its caller checks staleness itself.
    this.pending = null;
    const worker = this.ensureWorker();
    if (!worker) {
      return new Promise((resolve, reject) => {
        try {
          resolve(runMonteCarlo(design, runs, seed));
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
    }
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending = { id, resolve, reject };
      const request: MonteCarloRequest = { requestId: id, design, runs, seed };
      worker.postMessage(request);
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.pending = null;
  }
}
