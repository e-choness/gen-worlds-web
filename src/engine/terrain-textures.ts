// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
/**
 * Shared ground textures (CC0, Poly Haven — see CREDITS.md, fetched by
 * tools/fetch-textures.mjs). One set for the whole app: planets differ by palette, and the terrain
 * shader uses the textures for *relative* detail (texture ÷ its mean colour), so the same rock
 * photograph serves a red desert world and a grey moon.
 */
import * as THREE from 'three/webgpu';
import type { Disposable } from '@/core/disposable';
import { TERRAIN_LAYERS, type TerrainLayer } from '@/data/terrain-layers';

export interface TextureSet {
  albedo: THREE.Texture;
  normal: THREE.Texture;
}

export type { TerrainLayer };

export class TerrainTextures implements Disposable {
  readonly sets: Record<TerrainLayer, TextureSet>;

  constructor() {
    const loader = new THREE.TextureLoader();
    const load = (name: string, color: boolean): THREE.Texture => {
      // Returns immediately; the GPU texture updates when the image has decoded.
      const texture = loader.load(`${import.meta.env.BASE_URL}textures/${name}.jpg`);
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.anisotropy = 8;
      texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      return texture;
    };
    const sets = {} as Record<TerrainLayer, TextureSet>;
    for (const layer of TERRAIN_LAYERS) {
      sets[layer] = { albedo: load(`${layer}_albedo`, true), normal: load(`${layer}_normal`, false) };
    }
    this.sets = sets;
  }

  dispose(): void {
    for (const layer of TERRAIN_LAYERS) {
      this.sets[layer].albedo.dispose();
      this.sets[layer].normal.dispose();
    }
  }
}
