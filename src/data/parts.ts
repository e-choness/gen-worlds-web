/** Spacecraft parts and instruments (source and units in `parts_catalog.json`). */
import { camelize, indexById } from '@/data/camelize';
import type { TierId } from '@/data/mission-constants';
import raw from '@/data/parts_catalog.json';

/** One slot per category on the vehicle, except instruments, which fill a list. */
export const SLOT_IDS = [
  'bus',
  'power',
  'battery',
  'propulsion',
  'adcs',
  'computer',
  'comms',
  'thermal',
  'mobility',
  'landing',
] as const;

export type SlotId = (typeof SLOT_IDS)[number];
export type PartCategory = SlotId | 'instrument';
export type SolarMounting = 'body' | 'vertical' | 'tracking_mast';

interface PartBase {
  id: string;
  name: string;
  massKg: number;
  /** Electrical draw while the part is on, W. */
  powerW: number;
  costMusd: number;
  /** NASA technology readiness level, 1–9: below 7 the part risks arriving late. */
  trl: number;
  failureRatePerYear: number;
  minTier: TierId;
  /** Plain-language trade-off, shown verbatim. */
  summary: string;
}

export interface BusPart extends PartBase {
  category: 'bus';
  /** Most mass of other equipment (excluding propellant) the frame can carry, kg. */
  payloadCapacityKg: number;
}

export interface SolarPart extends PartBase {
  category: 'power';
  powerKind: 'solar';
  areaM2: number;
  efficiency: number;
  mounting: SolarMounting;
}

export interface RtgPart extends PartBase {
  category: 'power';
  powerKind: 'rtg';
  /** Electrical output at the beginning of life, W. */
  powerBolW: number;
  /** Fractional loss of output per year (isotope decay plus thermocouple ageing). */
  decayPerYear: number;
  /** Heat available to keep the vehicle warm, W. */
  wasteHeatW: number;
}

export type PowerPart = SolarPart | RtgPart;

export interface BatteryPart extends PartBase {
  category: 'battery';
  capacityWh: number;
  /** Usable share of the capacity. */
  depthOfDischarge: number;
}

export interface PropulsionPart extends PartBase {
  category: 'propulsion';
  ispS: number;
  thrustN: number;
  /** Tank and plumbing mass per kg of propellant loaded. */
  tankMassFraction: number;
  /** Longest time the propellant can be stored before the main burns, days. */
  maxCoastDays: number;
}

export interface AdcsPart extends PartBase {
  category: 'adcs';
  /** 1 coarse, 2 precise, 3 fine: antennas and instruments state the class they need. */
  pointingClass: number;
}

export interface ComputerPart extends PartBase {
  category: 'computer';
  storageGb: number;
  radiationHardened: boolean;
  /** 1 needs step-by-step commands from Earth; 2 can drive and drill on its own. */
  autonomy: number;
}

export interface CommsPart extends PartBase {
  category: 'comms';
  txPowerW: number;
  antennaDiameterM: number;
  /** Hardware ceiling on the downlink rate, Mbit/s. */
  maxRateMbps: number;
  needsPointingClass: number;
  /** True when the link goes to a relay orbiter instead of straight to Earth. */
  relay: boolean;
}

export interface ThermalPart extends PartBase {
  category: 'thermal';
  /** Multiplies the environment's heater demand: lower is better insulated. */
  heatLeakFactor: number;
  /** Free heat from radioisotope heater units, W. */
  radioisotopeHeatW: number;
}

export interface MobilityPart extends PartBase {
  category: 'mobility';
  /** Ground covered per hour of driving on average, stops included, m. */
  speedMPerH: number;
  maxSlopeDeg: number;
}

export interface LandingPart extends PartBase {
  category: 'landing';
  /** Multiplies the nominal descent Δv (hover and divert allowance). */
  descentDeltaVFactor: number;
  landingAccuracyM: number;
  /** Chance of a failed touchdown on benign terrain. */
  landingFailureRisk: number;
}

export interface InstrumentPart extends PartBase {
  category: 'instrument';
  /** Mbit/s produced while operating. */
  dataRateMbps: number;
  scienceValue: number;
  /** Measurement tags that scenario objectives ask for. */
  measures: string[];
  needsPointingClass: number;
  /** Depth reached, m (0 for instruments that do not drill). */
  drillDepthM: number;
  /** Width of ground imaged from 500 km, km (0 for instruments that do not image the ground). */
  swathKmAt500: number;
  /** Smallest detail resolved from 500 km, m (0 for instruments that do not image the ground). */
  gsdMAt500: number;
}

export type Part =
  | BusPart
  | PowerPart
  | BatteryPart
  | PropulsionPart
  | AdcsPart
  | ComputerPart
  | CommsPart
  | ThermalPart
  | MobilityPart
  | LandingPart
  | InstrumentPart;

export const PARTS: readonly Part[] = camelize<Part[]>(raw.parts);

const BY_ID = indexById(PARTS, 'part');

export function getPart(id: string): Part {
  const part = BY_ID.get(id);
  if (!part) throw new Error(`Unknown part "${id}".`);
  return part;
}

export function findPart(id: string): Part | undefined {
  return BY_ID.get(id);
}
