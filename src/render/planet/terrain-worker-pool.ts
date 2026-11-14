// Gen Worlds © 2026 Echo Yin. PolyForm Noncommercial 1.0.0: see LICENSE.md.
import type { Disposable } from '@/core/disposable';
import type { HeightmapData } from '@/universe/heightmap';
import type { ChunkData } from './chunk-builder';
import type { ChunkRequest, ChunkResponse, HeightmapMessage } from './terrain.worker';

type Job = Omit<ChunkRequest, 'requestId'>;

interface Pending {
  job: Job;
  /** Larger = more urgent. Re-evaluated lazily when the job is dequeued. */
  priority: () => number;
  resolve: (data: ChunkData | null) => void;
  cancelled: boolean;
}

export interface ChunkTicket {
  promise: Promise<ChunkData | null>;
  /** Drops the job if it has not started; a started job resolves normally and the caller discards it. */
  cancel(): void;
}

/**
 * Fixed pool of terrain workers with a priority queue. One job per worker at a time so that
 * priorities stay fresh: the queue is re-sorted against the *current* camera whenever a worker frees.
 */
export class TerrainWorkerPool implements Disposable {
  private readonly workers: Worker[] = [];
  private readonly idle: Worker[] = [];
  private readonly queue: Pending[] = [];
  private readonly running = new Map<number, Pending>();
  private nextId = 1;
  private readonly heightmapsSent = new Set<string>();

  constructor(size = Math.max(2, Math.min(8, (navigator.hardwareConcurrency || 4) - 2))) {
    for (let i = 0; i < size; i++) {
      const worker = new Worker(new URL('./terrain.worker.ts', import.meta.url), {
        type: 'module',
        name: `terrain-${i}`,
      });
      worker.onmessage = (event: MessageEvent<ChunkResponse>) => this.onResult(worker, event.data);
      worker.onerror = (event) => console.error('[terrain worker]', event.message);
      this.workers.push(worker);
      this.idle.push(worker);
    }
  }

  get pendingCount(): number {
    return this.queue.length + this.running.size;
  }

  /**
   * Gives every worker the measured elevation of a real body (a copy each: no shared memory on
   * GitHub Pages). Must be called before the body's first chunk request; repeat calls are ignored.
   */
  setHeightmap(bodyId: string, heightmap: HeightmapData): void {
    if (this.heightmapsSent.has(bodyId)) return;
    this.heightmapsSent.add(bodyId);
    const message: HeightmapMessage = { heightmapFor: bodyId, heightmap };
    for (const worker of this.workers) worker.postMessage(message);
  }

  request(job: Job, priority: () => number): ChunkTicket {
    let entry!: Pending;
    const promise = new Promise<ChunkData | null>((resolve) => {
      entry = { job, priority, resolve, cancelled: false };
    });
    this.queue.push(entry);
    this.pump();
    return {
      promise,
      cancel: () => {
        if (entry.cancelled) return;
        entry.cancelled = true;
        const index = this.queue.indexOf(entry);
        if (index >= 0) {
          this.queue.splice(index, 1);
          entry.resolve(null);
        }
      },
    };
  }

  private pump(): void {
    while (this.idle.length > 0 && this.queue.length > 0) {
      // Linear scan for the most urgent job: queues are short (tens of entries).
      let best = 0;
      let bestPriority = Number.NEGATIVE_INFINITY;
      for (let i = 0; i < this.queue.length; i++) {
        const p = this.queue[i].priority();
        if (p > bestPriority) {
          bestPriority = p;
          best = i;
        }
      }
      const entry = this.queue.splice(best, 1)[0];
      const worker = this.idle.pop() as Worker;
      const requestId = this.nextId++;
      this.running.set(requestId, entry);
      const message: ChunkRequest = { requestId, ...entry.job };
      worker.postMessage(message);
    }
  }

  private onResult(worker: Worker, response: ChunkResponse): void {
    const entry = this.running.get(response.requestId);
    this.running.delete(response.requestId);
    this.idle.push(worker);
    entry?.resolve(entry.cancelled ? null : response.data);
    this.pump();
  }

  dispose(): void {
    for (const worker of this.workers) worker.terminate();
    for (const entry of this.queue) entry.resolve(null);
    for (const entry of this.running.values()) entry.resolve(null);
    this.queue.length = 0;
    this.running.clear();
    this.workers.length = 0;
    this.idle.length = 0;
  }
}
