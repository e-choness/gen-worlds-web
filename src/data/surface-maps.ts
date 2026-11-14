// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
/** Which real bodies have measured colour and elevation maps (source and format in the JSON). */
import { camelize } from '@/data/camelize';
import raw from '@/data/surface_maps.json';

export interface SurfaceMapEntry {
  /** Body catalog id. */
  body: string;
  albedo: string;
  height: string;
  heightWidth: number;
  heightHeight: number;
  referenceRadiusM: number;
  /** Brightness applied to the colour map to bring its display stretch back toward true reflectance. */
  albedoGain: number;
}

export const SURFACE_MAPS: readonly SurfaceMapEntry[] = camelize<SurfaceMapEntry[]>(raw.maps);
