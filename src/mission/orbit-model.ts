/**
 * What the chosen orbit means for a satellite: how long each eclipse lasts, how much of the day a
 * ground station is in view, how fast the air drags it down and what it costs to hold the orbit and
 * to leave it. Everything else about an orbiter mission (power, data, propellant) follows from here.
 */
import { DEG } from '@/astro/constants';
import { hohmannTransfer } from '@/astro/orbits';
import {
  type AtmosphereLayer,
  atmosphereDensity,
  circularOrbitPeriod,
  contactFraction,
  dragLifetime,
  eclipseFraction,
  maxPassDuration,
  type OrbitedBody,
  sunSynchronousInclination,
} from '@/astro/planet-orbit';
import { type BodyData, getBody } from '@/data/bodies';
import type { OrbitMission } from '@/data/scenarios';
import { installedParts, type ResolvedDesign } from '@/mission/design';

const DAY_S = 86400;
const YEAR_S = 365.25 * DAY_S;
/** Natural lifetimes are not followed beyond this: "decades" is all the player needs to know. */
const LIFETIME_CAP_YEARS = 60;

export interface OrbitGeometry {
  altitudeKm: number;
  periodS: number;
  /** Share of each orbit in the planet's shadow. */
  eclipseFraction: number;
  /** Longest stretch in shadow, hours. */
  eclipseHours: number;
  /** Share of the day in view of the ground stations. */
  contactFraction: number;
  /** Longest gap between passes, hours (a single high-latitude station sees most orbits). */
  longestGapHours: number;
  /** Speed of the point under the satellite, km/s. */
  groundSpeedKmS: number;
}

export interface OrbitModel extends OrbitGeometry {
  /** Mass over drag area, kg/m². */
  ballisticCoefficient: number;
  /** Years until drag brings an uncontrolled satellite down from this orbit (capped). */
  naturalLifetimeYears: number;
  /** Δv to hold the altitude for a year, m/s. */
  maintenanceDeltaVPerYear: number;
  /** Δv of the burn that drops the perigee into the atmosphere, m/s. */
  deorbitDeltaV: number;
}

export function orbitedBody(body: BodyData): OrbitedBody {
  return {
    mu: body.mu,
    radius: body.equatorialRadiusM,
    j2: body.j2,
    rotationPeriod: body.siderealRotationS,
    yearLength: body.yearS,
  };
}

export function atmosphereLayers(body: BodyData): AtmosphereLayer[] {
  return body.atmosphereLayers.map((layer) => ({
    baseAltitude: layer.baseAltitudeM,
    baseDensity: layer.baseDensityKgM3,
    scaleHeight: layer.scaleHeightM,
  }));
}

/** The geometry of a circular sun-synchronous orbit at `altitudeM`; used again as the orbit decays. */
export function orbitGeometry(
  body: OrbitedBody,
  mission: OrbitMission,
  altitudeM: number,
  betaAngleDeg: number,
): OrbitGeometry {
  const periodS = circularOrbitPeriod(body, altitudeM);
  const eclipse = eclipseFraction(body, altitudeM, betaAngleDeg * DEG);
  const inclination = sunSynchronousInclination(body, altitudeM) ?? Math.PI / 2;
  const minElevation = mission.minElevationDeg * DEG;
  const contact = Math.min(
    1,
    mission.stationCount *
      contactFraction(body, altitudeM, inclination, mission.stationLatitudeDeg * DEG, minElevation),
  );
  // Passes come in a run of consecutive orbits, then the station turns away for the rest of the day.
  const passS = maxPassDuration(body, altitudeM, minElevation) * 0.7;
  const passesPerDay = passS > 0 ? (contact * DAY_S) / passS : 0;
  const longestGapHours =
    passesPerDay > 0 ? Math.max(periodS / 3600, 24 - (passesPerDay * periodS) / 3600) : 24;
  return {
    altitudeKm: altitudeM / 1000,
    periodS,
    eclipseFraction: eclipse,
    eclipseHours: (eclipse * periodS) / 3600,
    contactFraction: contact,
    longestGapHours,
    groundSpeedKmS: (2 * Math.PI * body.radius) / periodS / 1000,
  };
}

/** Null until an orbit is chosen (or for a mission that lands). */
export function computeOrbitModel(resolved: ResolvedDesign): OrbitModel | null {
  const { scenario, orbit, power } = resolved;
  const mission = scenario.orbit;
  if (!mission || !orbit) return null;
  const data = getBody(scenario.targetBody);
  const body = orbitedBody(data);
  const layers = atmosphereLayers(data);
  const altitudeM = orbit.altitudeKm * 1000;
  const geometry = orbitGeometry(body, mission, altitudeM, orbit.betaAngleDeg);

  const massKg = Math.max(
    1,
    installedParts(resolved).reduce((sum, item) => sum + item.massKg, 0),
  );
  // Deployed arrays face the airflow about half the time.
  const arrayAreaM2 = power?.powerKind === 'solar' ? power.areaM2 : 0;
  const dragAreaM2 = mission.bodyFrontalAreaM2 + 0.5 * arrayAreaM2;
  const ballisticCoefficient = massKg / (mission.dragCoefficient * dragAreaM2);
  const naturalLifetimeYears =
    dragLifetime(
      body,
      layers,
      altitudeM,
      ballisticCoefficient,
      mission.reentryAltitudeKm * 1000,
      LIFETIME_CAP_YEARS * YEAR_S,
    ) / YEAR_S;
  const radius = body.radius + altitudeM;
  const speed = Math.sqrt(body.mu / radius);
  const dragAcceleration =
    (atmosphereDensity(layers, altitudeM) * speed * speed) / (2 * ballisticCoefficient);
  return {
    ...geometry,
    ballisticCoefficient,
    naturalLifetimeYears,
    maintenanceDeltaVPerYear: dragAcceleration * YEAR_S,
    deorbitDeltaV: hohmannTransfer(body.mu, radius, body.radius + mission.deorbitPerigeeKm * 1000).deltaV1,
  };
}
