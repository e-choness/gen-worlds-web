/** Mission scenarios (source and units in each `scenario_*.json`). */
import { camelize, indexById } from '@/data/camelize';
import type { SlotId, SolarMounting } from '@/data/parts';
import type { PlanetId } from '@/data/planet-elements';
import lunarIceProspector from '@/data/scenario_lunar_ice_prospector.json';
import marsJezeroSurvey from '@/data/scenario_mars_jezero_survey.json';

export type TrajectoryMode = 'earth_orbit' | 'lunar' | 'interplanetary';

/** The resources the budget panel tracks; a scenario marks which ones are critical. */
export type ResourceId =
  | 'mass'
  | 'delta_v'
  | 'launch'
  | 'power'
  | 'thermal'
  | 'data'
  | 'cost'
  | 'schedule'
  | 'risk';

/** What the simulation measures to judge an objective. */
export type ObjectiveMetric = 'traverse_km' | 'ice_samples' | 'data_returned_gb' | 'context_measures';

export interface TransferOption {
  id: string;
  name: string;
  durationDays: number;
  /** Launch energy the launcher must deliver, km²/s². */
  c3Km2S2: number;
  correctionDeltaVMS: number;
  orbitInsertionDeltaVMS: number;
  summary: string;
}

export interface LandingSite {
  id: string;
  name: string;
  latitudeDeg: number;
  /** East positive. */
  longitudeDeg: number;
  /** Elevation of the local horizon in 12 azimuth sectors of 30°, from north going east. */
  horizonMaskDeg: number[];
  /** 0–1: how rich the science target here is (ice in the shadowed ground, the rock record). */
  iceQuality: number;
  /** Drive from the landing zone to the science target, km (0 = landing on it). */
  shadowDistanceKm: number;
  /** Multiplies the landing system's failure risk. */
  landingHazardFactor: number;
  /** Steepest slope on the way to the ice, degrees. */
  slopeDeg: number;
  summary: string;
}

export interface Objective {
  id: string;
  name: string;
  summary: string;
  /** Every tag must be covered by the chosen instruments for the objective to score at all. */
  requiresMeasures: string[];
  metric: ObjectiveMetric;
  /** Below the threshold the objective scores nothing; at the target it scores in full. */
  threshold: number;
  target: number;
  /** Share of the science score; the weights of a scenario sum to 1. */
  weight: number;
}

export interface ScenarioEnvironment {
  solarDistanceAu: number;
  /** Distance the downlink has to cross, au. */
  earthDistanceAu: number;
  /** Average share of full output a solar array of each mounting delivers here when lit. */
  mountingFactors: { mounting: SolarMounting; factor: number }[];
  /** Heater power needed in shadow by a vehicle of the reference mass with no insulation credit, W. */
  heaterDemandShadowW: number;
  heaterReferenceMassKg: number;
  /** Share of the heater demand that keeps a hibernating vehicle alive. */
  survivalHeaterFraction: number;
  /** Electronics draw while hibernating, W. */
  hibernationLoadW: number;
  dustDegradationPerDay: number;
}

export interface ScenarioOperations {
  /** Shares of the working day spent driving, running instruments and transmitting. */
  driveFraction: number;
  scienceFraction: number;
  commsFraction: number;
  drillHoursPerSample: number;
  /** Time one excursion into shadow takes, h: the battery must carry it. */
  shadowSortieHours: number;
  /** Time the ground team needs to plan the next excursion, h. */
  sortiePlanningHours: number;
  /** The Sun / Earth count as visible this far above the local horizon, degrees. */
  minSunClearanceDeg: number;
  minEarthClearanceDeg: number;
  /** Share of time a relay orbiter is in view. */
  relayCoverageFraction: number;
  groundStation: string;
  groundPassHoursPerDay: number;
  /**
   * True when the science target lies in permanent shadow, so sampling means battery-powered
   * excursions; false when the vehicle samples in daylight once it has driven there.
   */
  targetInShadow: boolean;
  /** Chance factor of a sample holding the find, by the depth the drill reaches. */
  sampleFindByDepth: { depthM: number; factor: number }[];
}

/** The words that differ between destinations, used inside explanation strings. */
export interface ScenarioTerms {
  /** "the Moon" */
  destination: string;
  /** "prospector" */
  vehicle: string;
  /** "lunar weight" */
  localWeight: string;
  /** "the shadowed, ice-bearing ground" */
  targetGround: string;
  /** "the ice" */
  targetShort: string;
  /** Title of the first find: "Water ice confirmed". */
  findTitle: string;
  /** Completes "The first sample …": "with water ice came up". */
  findDetail: string;
  /** Completes "3 samples …": "with ice confirmed". */
  sampleCount: string;
  /** Completes "the rover …" in the headline: "confirmed water ice in" / "found no ice". */
  foundIn: string;
  noFind: string;
  /** Completes "5 samples …": "came up dry". */
  emptySample: string;
  /** What finds it more often: "A richer site or a deeper drill finds ice more often." */
  findAdvice: string;
  /** Labels on the landing-site cards. */
  qualityLabel: string;
  driveLabel: string;
  atTarget: string;
}

/** How the Sun and Earth move in the destination's sky. */
export interface SkyModel {
  /** `lunar`: real lunar geometry with horizon masks. `diurnal`: a rotating planet with seasons. */
  model: 'lunar' | 'diurnal';
  /** Heliocentric ecliptic longitude of the planet at its northern spring equinox, degrees. */
  equinoxLongitudeDeg: number;
  /** Local solar time of touchdown, hours. */
  landingLocalHour: number;
  /** Earth closer to the Sun than this in the sky cannot be heard through the solar noise, degrees. */
  conjunctionElongationDeg: number;
}

/** Atmospheric entry in place of a braking burn into orbit. */
export interface EntrySystem {
  /** Aeroshell, parachute and cruise stage as a share of the fuelled lander's mass. */
  massFraction: number;
  /** Fastest entry the heat shield survives, m/s. */
  maxEntrySpeedMS: number;
  /** Altitude of the entry interface, m. */
  interfaceAltitudeM: number;
}

/** A ballistic transfer between two planets, with the dates left to the player. */
export interface InterplanetaryRoute {
  from: PlanetId;
  to: PlanetId;
  name: string;
  /** ISO dates (UTC) between which the launch may be scheduled. */
  departureWindow: { startDate: string; endDate: string };
  correctionDeltaVMS: number;
  summary: string;
}

export interface Scenario {
  id: string;
  number: number;
  name: string;
  tagline: string;
  briefing: string;
  trajectoryMode: TrajectoryMode;
  targetBody: string;
  criticalResources: ResourceId[];
  budgetCapMusd: number;
  operationsCostMusdPerMonth: number;
  surfaceDurationDays: number;
  requiredSlots: SlotId[];
  optionalSlots: SlotId[];
  maxInstruments: number;
  /** Ids of the parts offered in this scenario. */
  catalog: string[];
  launchVehicles: string[];
  launchAdapterMassKg: number;
  /** ISO dates (UTC) between which the landing may be scheduled. */
  landingWindow: { startDate: string; endDate: string };
  /** Fixed routes to choose from; empty when `route` lets the player pick the dates instead. */
  transfers: TransferOption[];
  route: InterplanetaryRoute | null;
  entry: EntrySystem | null;
  sky: SkyModel;
  terms: ScenarioTerms;
  descent: {
    /** Orbit to touchdown, m/s. */
    deltaVMS: number;
    minThrustToWeight: number;
    summary: string;
    /** Part of `deltaVMS` spent below the altitude where a human pilot can take over. */
    terminalDeltaVMS: number;
    /** State at hand-over to the pilot. */
    startAltitudeM: number;
    startDescentRateMS: number;
    startGroundSpeedMS: number;
    startRangeM: number;
    /** Vertical speed and sideways drift a landing survives, m/s. */
    maxTouchdownSpeedMS: number;
    maxTouchdownDriftMS: number;
  };
  environment: ScenarioEnvironment;
  operations: ScenarioOperations;
  sites: LandingSite[];
  objectives: Objective[];
  /** Ids from the events catalog that can occur here. */
  events: string[];
  /** A complete, sensible design players can load as a starting point. */
  referenceDesign: {
    name: string;
    summary: string;
    slots: { slot: SlotId; part: string }[];
    instruments: string[];
    launchVehicle: string;
    transfer: string;
    site: string;
    /** ISO date (UTC) of the landing. */
    landingDate: string;
    /** ISO date (UTC) of the launch, for scenarios with a `route`; empty otherwise. */
    departureDate: string;
  };
  nasaReference: { mission: string; summary: string; url: string };
}

export const SCENARIOS: readonly Scenario[] = [
  camelize<Scenario>(lunarIceProspector),
  camelize<Scenario>(marsJezeroSurvey),
];

const BY_ID = indexById(SCENARIOS, 'scenario');

export function getScenario(id: string): Scenario {
  const scenario = BY_ID.get(id);
  if (!scenario) throw new Error(`Unknown scenario "${id}".`);
  return scenario;
}
