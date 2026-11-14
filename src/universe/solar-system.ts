// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0 or MIT: see LICENSE.md.
/**
 * The real solar system as a `SystemDesc`: sizes, masses, spin and temperature from the NASA body
 * catalog, positions from the JPL ephemeris and the lunar series. Surface look is still generated
 * by class until real albedo and height data replace it body by body.
 *
 * Frame: system space has the Sun at the origin and +Y toward the ecliptic north pole, so ecliptic
 * (x, y, z) maps to system (x, z, −y).
 */
import { planetState } from '@/astro/ephemeris';
import { moonPosition } from '@/astro/moon';
import { Rng } from '@/core/random';
import { type BodyData, getBody } from '@/data/bodies';
import { PLANET_IDS, type PlanetId } from '@/data/planet-elements';
import { AU, SOLAR_RADIUS } from './constants';
import { makeCatalogBody } from './system';
import type { BodyDesc, PlanetKind, StarDesc, SystemDesc, Vec3Tuple } from './types';

const SYSTEM_ID = 'sol';
const DEG = Math.PI / 180;
const MU_EARTH = getBody('earth').mu;
/** Fixed seeds keep each world's generated look the same in every session. */
const LOOK_SEED = 0x501a2;
/** Bodies whose rings are a defining feature. */
const RINGED = new Set(['saturn']);

const SUN: StarDesc = {
  id: SYSTEM_ID,
  seed: LOOK_SEED,
  name: 'Sun',
  class: 'G',
  spectralType: 'G2V',
  temperatureK: 5772,
  radius: SOLAR_RADIUS,
  massSolar: 1,
  luminositySolar: 1,
  // Sunlight is the white point here: real colour maps are balanced for it.
  color: [1, 1, 1],
  // About 26,000 light-years from the galactic centre, a little above the plane.
  positionLy: [26000, 55, 900],
  ageGyr: 4.6,
};

function catalogBody(data: BodyData, parentId: string | null, index: number): BodyDesc {
  const body = makeCatalogBody({
    rng: new Rng(LOOK_SEED + index * 7919),
    id: `${SYSTEM_ID}/${data.id}`,
    name: data.name,
    kind: data.renderKind as PlanetKind,
    parentId,
    orbitRadius: data.meanSolarDistanceAu * AU,
    equilibriumK: data.meanTemperatureK,
    starMassSolar: 1,
    fixed: {
      radius: data.equatorialRadiusM,
      massEarths: data.mu / MU_EARTH,
      gravity: data.surfaceGravityMS2,
      temperatureK: data.meanTemperatureK,
      axialTilt: data.axialTiltDeg * DEG,
      dayLengthHours: data.solarDayS / 3600,
      orbitalPeriodDays: data.yearS / 86400,
      rings: RINGED.has(data.id),
      surfacePressureBar: data.surfacePressurePa > 0 ? data.surfacePressurePa / 1e5 : undefined,
    },
  });
  // A measured surface should stay visible under the generated weather.
  if (data.cloudCoverage === undefined || !body.clouds) return body;
  return {
    ...body,
    clouds: data.cloudCoverage > 0 ? { ...body.clouds, coverage: data.cloudCoverage } : null,
  };
}

/** The catalog id ("earth", "moon"…) of a body of the solar system, or null for any other body. */
export function solarBodyId(body: BodyDesc): string | null {
  return body.id.startsWith(`${SYSTEM_ID}/`) ? body.id.slice(SYSTEM_ID.length + 1) : null;
}

export function createSolarSystem(): SystemDesc {
  const planets = PLANET_IDS.map((id, index) => catalogBody(getBody(id), null, index));
  const earth = planets.find((planet) => solarBodyId(planet) === 'earth');
  if (earth) earth.moons.push(catalogBody(getBody('moon'), earth.id, 100));
  return { star: SUN, planets, real: true };
}

/**
 * Position of a solar-system body in system space at a Julian date, metres.
 * @returns false when `id` is not a body this module can place.
 */
export function solarBodyPosition(id: string, jd: number, out: Vec3Tuple): boolean {
  if (id === 'moon') {
    const earth = planetState('earth', jd).r;
    const moon = moonPosition(jd);
    out[0] = earth[0] + moon[0];
    out[1] = earth[2] + moon[2];
    out[2] = -(earth[1] + moon[1]);
    return true;
  }
  if (!(PLANET_IDS as string[]).includes(id)) return false;
  const r = planetState(id as PlanetId, jd).r;
  out[0] = r[0];
  out[1] = r[2];
  out[2] = -r[1];
  return true;
}
