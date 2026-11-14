// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
/**
 * Where a scenario's pictures come from. Catalog scenarios ship theirs; a generated world's picture
 * is the view the player had when they chose to plan a mission there, kept for the browser session,
 * or else a portrait drawn from the world's own terrain and colours.
 */
import { hashString } from '@/core/random';
import { decodeWorld, isWorldId } from '@/data/world';
import { worldPortrait } from '@/ui/world-portrait';

const shotKey = (scenarioId: string): string => `gen-worlds.shot.${hashString(scenarioId)}`;

/** Keeps `dataUrl` as the picture of the generated world `scenarioId`. Fails quietly when storage is full. */
export function saveWorldShot(scenarioId: string, dataUrl: string): void {
  try {
    sessionStorage.setItem(shotKey(scenarioId), dataUrl);
  } catch {
    // No storage or no room: the scenario's stock picture stands in.
  }
}

/** The URL to show for a scenario picture given as a path relative to the site root. */
export function artUrl(path: string, scenarioId: string): string {
  if (isWorldId(scenarioId)) {
    try {
      const shot = sessionStorage.getItem(shotKey(scenarioId));
      if (shot) return shot;
    } catch {
      // Storage blocked: fall through to the drawn portrait.
    }
    try {
      const portrait = worldPortrait(scenarioId, decodeWorld(scenarioId));
      if (portrait) return portrait;
    } catch {
      // An id that does not decode: the stock picture stands in.
    }
  }
  return import.meta.env.BASE_URL + path;
}
