// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
/**
 * Background preloading: while the player reads the title and the briefing, the pictures, code and
 * data of the screens ahead are fetched, so opening the hangar, a landing or the sandbox does not
 * start with a download.
 *
 * Items load one at a time, in the order the player is likely to need them, and only while the
 * browser is idle, so preloading never competes with what is on screen. Files go to the browser's
 * HTTP cache (and modules to the module map); nothing is kept in memory here. The large 3D files are
 * skipped where there is no WebGPU to use them, and on connections that ask for less data.
 *
 * Shader compilation is not warmed: that needs the renderer itself, which starts with the 3D view.
 */
import { SCENARIOS } from '@/data/scenarios';
import { SURFACE_MAPS } from '@/data/surface-maps';
import { terrainTextureFiles } from '@/data/terrain-layers';

/** Sound effects the 3D view decodes at start (the music streams and is not preloaded). */
const SOUND_EFFECTS = ['sfx-thruster', 'sfx-drill', 'sfx-scan', 'sfx-chime', 'sfx-thunder'] as const;
/** Pause before the first item, so the first screen settles before anything else is fetched. */
const START_DELAY_MS = 1500;
/** Longest wait for an idle moment before loading the next item anyway: an animated screen is never idle. */
const IDLE_TIMEOUT_MS = 300;

interface NetworkHint {
  saveData?: boolean;
  effectiveType?: string;
}

/** True when the connection asks for less data or is too slow for tens of megabytes unasked. */
function constrainedNetwork(): boolean {
  const connection = (navigator as Navigator & { connection?: NetworkHint }).connection;
  if (!connection) return false;
  return (
    connection.saveData === true ||
    (connection.effectiveType !== undefined && connection.effectiveType !== '4g')
  );
}

const siteUrl = (path: string): string => import.meta.env.BASE_URL + path;

/** Fetches and decodes a picture, so showing it later costs nothing. */
function image(path: string): () => Promise<unknown> {
  return () => {
    const element = new Image();
    element.src = siteUrl(path);
    return element.decode();
  };
}

/** Downloads a file into the HTTP cache. */
function file(path: string): () => Promise<unknown> {
  return async () => {
    const response = await fetch(siteUrl(path));
    // Reading the body is what completes the download; the bytes themselves are dropped.
    await response.arrayBuffer();
  };
}

export interface Preloader {
  /** Stops after the item in flight: called when the 3D view starts and needs the bandwidth. */
  stop(): void;
}

/**
 * Starts preloading for the mission screens. `webgpu` says whether the 3D views can run at all.
 * Failures are ignored: every item is loaded again, with proper error handling, where it is used.
 */
export function startPreload(webgpu: boolean): Preloader {
  const queue: Array<() => Promise<unknown>> = [];
  const pictures = new Set(SCENARIOS.flatMap((scenario) => [scenario.art, scenario.stageArt]));
  for (const path of pictures) queue.push(image(path));

  if (webgpu) {
    // Code first: the hangar's 3D vehicle is the first 3D thing the player meets.
    queue.push(() => import('@/render/hangar/vehicle-view'));
    queue.push(() => import('@/app/descent'));
    queue.push(() => import('@/app/sandbox'));
    queue.push(() => import('@/app/demo'));
    if (!constrainedNetwork()) {
      for (const path of terrainTextureFiles()) queue.push(file(path));
      for (const name of SOUND_EFFECTS) queue.push(file(`audio/${name}.mp3`));
      // Measured maps last and largest: colour before elevation, in mission order.
      const order = new Map(SCENARIOS.map((scenario, index) => [scenario.targetBody, index]));
      const maps = [...SURFACE_MAPS].sort(
        (a, b) => (order.get(a.body) ?? SCENARIOS.length) - (order.get(b.body) ?? SCENARIOS.length),
      );
      for (const map of maps) queue.push(file(map.albedo));
      for (const map of maps) queue.push(file(map.height));
    }
  }

  let stopped = false;
  const idle = (run: () => void): void => {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS });
    else setTimeout(run, 200);
  };
  const next = (): void => {
    const item = queue.shift();
    if (stopped || !item) return;
    idle(() => {
      if (stopped) return;
      item()
        .catch(() => undefined)
        .then(next);
    });
  };
  setTimeout(next, START_DELAY_MS);
  return {
    stop: () => {
      stopped = true;
    },
  };
}
