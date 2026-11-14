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
}

export const SURFACE_MAPS: readonly SurfaceMapEntry[] = camelize<SurfaceMapEntry[]>(raw.maps);
