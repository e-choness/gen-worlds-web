// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0 or MIT: see LICENSE.md.
/** Physical data of the real bodies (source and units in `bodies_solar_system.json`). */
import raw from '@/data/bodies_solar_system.json';
import { camelize, indexById } from '@/data/camelize';
import { decodeWorld, isWorldId, worldBody } from '@/data/world';

export interface AtmosphereLayerData {
  baseAltitudeM: number;
  baseDensityKgM3: number;
  scaleHeightM: number;
}

export interface BodyData {
  id: string;
  name: string;
  /** Id of the body it orbits ("sun" for planets). */
  parent: string;
  /** Gravitational parameter, m³/s². */
  mu: number;
  equatorialRadiusM: number;
  surfaceGravityMS2: number;
  j2: number;
  siderealRotationS: number;
  /** Noon to noon, s: sets the length of day and night on the surface. */
  solarDayS: number;
  /** Orbital period around the Sun (for a moon: its planet's), s. */
  yearS: number;
  meanSolarDistanceAu: number;
  surfacePressurePa: number;
  /** Surface class the renderer draws the body as (a `PlanetKind` of the universe layer). */
  renderKind: string;
  /** Obliquity to the orbit, degrees (above 90 for retrograde spin). */
  axialTiltDeg: number;
  meanTemperatureK: number;
  /** Share of the sky the renderer covers with cloud (0 = none); absent to let the surface class decide. */
  cloudCoverage?: number;
  /** Piecewise-exponential upper atmosphere for drag; empty where it is not modelled. */
  atmosphereLayers: AtmosphereLayerData[];
}

export const BODIES: readonly BodyData[] = camelize<BodyData[]>(raw.bodies);

const BY_ID = indexById(BODIES, 'body');

export function getBody(id: string): BodyData {
  // A generated world carries its own facts in its id.
  if (isWorldId(id)) return worldBody(id, decodeWorld(id));
  const body = BY_ID.get(id);
  if (!body) throw new Error(`Unknown body "${id}".`);
  return body;
}
