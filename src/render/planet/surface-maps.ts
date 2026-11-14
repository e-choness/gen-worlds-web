/**
 * Loads and owns the measured colour and elevation maps of real bodies. Loaded once before a real
 * system is entered, so planet views can be created synchronously as bodies come into view.
 */
import * as THREE from 'three/webgpu';
import { subEarthPoint } from '@/astro/lunar-geometry';
import type { Disposable } from '@/core/disposable';
import { getBody } from '@/data/bodies';
import { SURFACE_MAPS } from '@/data/surface-maps';
import type { HeightmapData } from '@/universe/heightmap';
import { solarBodyId, solarBodyPosition } from '@/universe/solar-system';
import type { BodyDesc, SystemDesc, Vec3Tuple } from '@/universe/types';

export interface SurfaceMap {
  heightmap: HeightmapData;
  /** Equirectangular colour, sRGB. */
  albedo: THREE.Texture;
  /** Brightness applied to `albedo` in the shader. */
  albedoGain: number;
}

/**
 * System-space angle of a body's prime meridian at a date. The Moon keeps its near side toward the
 * Earth: its meridian is the direction of the Earth, less the longitude libration of that day.
 * The orientation is fixed at load; the Moon turns 13° a day, far slower than a play session.
 */
function meridianAt(id: string, jd: number): number {
  if (id !== 'moon') return 0;
  const moon: Vec3Tuple = [0, 0, 0];
  const earth: Vec3Tuple = [0, 0, 0];
  solarBodyPosition('moon', jd, moon);
  solarBodyPosition('earth', jd, earth);
  const towardEarth = Math.atan2(-(earth[2] - moon[2]), earth[0] - moon[0]);
  return towardEarth - subEarthPoint(jd).longitude;
}

export class SurfaceMaps implements Disposable {
  private readonly maps = new Map<string, SurfaceMap>();

  /**
   * Loads the maps of the bodies of `system` that have them: all of them, or just `only` (a catalog
   * id) when the session stays at one body, which saves tens of megabytes. Resolves empty for
   * generated systems.
   */
  static async load(system: SystemDesc, jd: number, only?: string): Promise<SurfaceMaps> {
    const store = new SurfaceMaps();
    if (!system.real) return store;
    const bodies = system.planets.flatMap((planet) => [planet, ...planet.moons]);
    await Promise.all(
      SURFACE_MAPS.map(async (entry) => {
        const body = bodies.find((candidate) => solarBodyId(candidate) === entry.body);
        if (!body || (only !== undefined && only !== entry.body)) return;
        const base = import.meta.env.BASE_URL;
        const [buffer, albedo] = await Promise.all([
          fetch(base + entry.height).then((response) => {
            if (!response.ok) throw new Error(`Could not load ${entry.height} (${response.status}).`);
            return response.arrayBuffer();
          }),
          new THREE.TextureLoader().loadAsync(base + entry.albedo),
        ]);
        if (buffer.byteLength !== entry.heightWidth * entry.heightHeight * 2) {
          throw new Error(`${entry.height} has an unexpected size.`);
        }
        albedo.colorSpace = THREE.SRGBColorSpace;
        // Row 0 of the image is the north pole, and the shader looks it up with v = 0 at the north.
        albedo.flipY = false;
        albedo.wrapS = THREE.RepeatWrapping;
        // No mip chain: the longitude seam of an equirectangular lookup would pick the smallest mip.
        albedo.generateMipmaps = false;
        albedo.minFilter = THREE.LinearFilter;
        store.maps.set(body.id, {
          albedo,
          albedoGain: entry.albedoGain,
          heightmap: {
            width: entry.heightWidth,
            height: entry.heightHeight,
            samples: new Int16Array(buffer),
            offset: entry.referenceRadiusM - getBody(entry.body).equatorialRadiusM,
            meridian: meridianAt(entry.body, jd),
            sea: body.ocean !== null,
          },
        });
      }),
    );
    return store;
  }

  get(body: BodyDesc): SurfaceMap | null {
    return this.maps.get(body.id) ?? null;
  }

  dispose(): void {
    for (const map of this.maps.values()) map.albedo.dispose();
    this.maps.clear();
  }
}
