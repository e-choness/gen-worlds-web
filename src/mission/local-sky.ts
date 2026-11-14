// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
/**
 * The sky of a generated world. There is no ephemeris for it, so the season is held at a fixed share
 * of the axial tilt for the length of a mission, and "home" is the expedition ship: a point in the
 * sky a fixed angle from the Sun, at a fixed distance.
 */
import { type PlanetSeason, planetSeason } from '@/astro/planet-sky';
import { PLANET_IDS, type PlanetId } from '@/data/planet-elements';
import type { SkyModel } from '@/data/scenarios';
import { WORLD_RULES } from '@/data/world-scenario';

const DEG = Math.PI / 180;

/** The slowly changing part of the sky at `jd`, for a planet of the solar system or a generated world. */
export function seasonFor(
  sky: SkyModel,
  bodyId: string,
  jd: number,
  axialTilt: number,
  linkDistanceAu: number,
): PlanetSeason {
  if (sky.model === 'local' || !(PLANET_IDS as readonly string[]).includes(bodyId)) {
    return {
      solarLongitude: 0,
      sunDeclination: axialTilt * WORLD_RULES.seasonFactor,
      earthDeclination: 0,
      earthElongation: WORLD_RULES.carrierElongationDeg * DEG,
      earthDistanceAu: linkDistanceAu,
    };
  }
  return planetSeason(bodyId as PlanetId, jd, axialTilt, sky.equinoxLongitudeDeg * DEG);
}
