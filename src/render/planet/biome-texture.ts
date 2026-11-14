// Gen Worlds © 2026 Echo Yin. PolyForm Noncommercial 1.0.0: see LICENSE.md.
/**
 * Packs a body's biome grid into two small textures the terrain shader samples with the climate
 * coordinates (u = wetness, v = temperature index). Linear filtering blends neighbouring biomes.
 *
 *   color: rgb = ground albedo, a = snow cover
 *   cover: r = grass / moss cover, g = loose sand cover, b = ground glow
 */
import * as THREE from 'three/webgpu';
import { BIOME_GRID, type BiomeMap } from '@/universe/biome';

export interface BiomeTextures {
  color: THREE.DataTexture;
  cover: THREE.DataTexture;
}

export function createBiomeTextures(map: BiomeMap): BiomeTextures {
  const n = BIOME_GRID;
  const color = new Uint16Array(n * n * 4);
  const cover = new Uint16Array(n * n * 4);
  const half = THREE.DataUtils.toHalfFloat;
  for (let i = 0; i < n * n; i++) {
    const b = map.biomes[map.grid[i]];
    color[i * 4] = half(b.color[0]);
    color[i * 4 + 1] = half(b.color[1]);
    color[i * 4 + 2] = half(b.color[2]);
    color[i * 4 + 3] = half(b.cover === 'snow' ? 1 : 0);
    cover[i * 4] = half(b.cover === 'grass' ? 1 : 0);
    cover[i * 4 + 1] = half(b.cover === 'sand' ? 1 : 0);
    cover[i * 4 + 2] = half(b.emissive);
    cover[i * 4 + 3] = half(1);
  }
  const make = (data: Uint16Array): THREE.DataTexture => {
    const texture = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.HalfFloatType);
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;
    return texture;
  };
  return { color: make(color), cover: make(cover) };
}
