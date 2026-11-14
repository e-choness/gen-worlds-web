/** Mission scenarios (source and units in each `scenario_*.json`). */
import { camelize, indexById } from '@/data/camelize';
import type { SlotId, SolarMounting } from '@/data/parts';
import lunarIceProspector from '@/data/scenario_lunar_ice_prospector.json';

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
  /** 0–1: how much ice the shadowed ground here holds. */
  iceQuality: number;
  /** Drive from the landing zone to shadowed, ice-bearing ground, km (0 = landing inside it). */
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
  transfers: TransferOption[];
  descent: { deltaVMS: number; minThrustToWeight: number; summary: string };
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
  };
  nasaReference: { mission: string; summary: string; url: string };
}

export const SCENARIOS: readonly Scenario[] = [camelize<Scenario>(lunarIceProspector)];

const BY_ID = indexById(SCENARIOS, 'scenario');

export function getScenario(id: string): Scenario {
  const scenario = BY_ID.get(id);
  if (!scenario) throw new Error(`Unknown scenario "${id}".`);
  return scenario;
}
