// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
/**
 * The photographed ground layers of the terrain shader. Each has `<layer>_albedo.jpg` and
 * `<layer>_normal.jpg` under `textures/` (sources in CREDITS.md). Kept apart from the texture
 * loader so the preloader can list the files without pulling in the 3D engine.
 */
export const TERRAIN_LAYERS = ['ground', 'grass', 'sand', 'rock', 'snow'] as const;
export type TerrainLayer = (typeof TERRAIN_LAYERS)[number];

/** Paths of every terrain texture, relative to the site root. */
export function terrainTextureFiles(): string[] {
  return TERRAIN_LAYERS.flatMap((layer) => [`textures/${layer}_albedo.jpg`, `textures/${layer}_normal.jpg`]);
}
