/**
 * The mission design: everything the team decides before launch. It is plain serialisable data
 * (ids and numbers only), so it can be saved, shared as a mission code and synced between players.
 * `resolveDesign` looks the ids up in the catalogs for the budget and simulation code.
 */
import { jdFromUnixMs } from '@/astro/time';
import { getLaunchVehicle, type LaunchVehicle } from '@/data/launch-vehicles';
import { getTier, MISSION_CONSTANTS, type Tier, type TierId, tierAllows } from '@/data/mission-constants';
import {
  type AdcsPart,
  type BatteryPart,
  type BusPart,
  type CommsPart,
  type ComputerPart,
  findPart,
  type InstrumentPart,
  type LandingPart,
  type MobilityPart,
  type Part,
  type PowerPart,
  type PropulsionPart,
  SLOT_IDS,
  type SlotId,
  type ThermalPart,
} from '@/data/parts';
import { getScenario, type LandingSite, type Scenario, type TransferOption } from '@/data/scenarios';

export interface TrajectoryChoice {
  launchVehicleId: string | null;
  transferId: string | null;
  siteId: string | null;
  /** Julian date of touchdown, or null until the team picks one. */
  landingJd: number | null;
}

export interface MissionDesign {
  scenarioId: string;
  tier: TierId;
  /** Part id per slot; a missing key is an empty slot. */
  slots: Partial<Record<SlotId, string>>;
  /** Instrument part ids, in the order they were added. */
  instruments: string[];
  /** Slots that carry a second, backup unit. */
  redundant: SlotId[];
  trajectory: TrajectoryChoice;
}

export function createEmptyDesign(scenarioId: string, tier: TierId): MissionDesign {
  return {
    scenarioId,
    tier,
    slots: {},
    instruments: [],
    redundant: [],
    trajectory: { launchVehicleId: null, transferId: null, siteId: null, landingJd: null },
  };
}

/** The scenario's reference design at the given tier: a complete starting point to change. */
export function createReferenceDesign(scenario: Scenario, tier: TierId): MissionDesign {
  const reference = scenario.referenceDesign;
  const slots: Partial<Record<SlotId, string>> = {};
  for (const entry of reference.slots) slots[entry.slot] = entry.part;
  return {
    scenarioId: scenario.id,
    tier,
    slots,
    instruments: [...reference.instruments],
    redundant: [],
    trajectory: {
      launchVehicleId: reference.launchVehicle,
      transferId: reference.transfer,
      siteId: reference.site,
      landingJd: jdFromUnixMs(Date.parse(reference.landingDate)),
    },
  };
}

/** The design with catalog records in place of ids. Unknown or misplaced ids resolve to empty. */
export interface ResolvedDesign {
  design: MissionDesign;
  scenario: Scenario;
  tier: Tier;
  bus?: BusPart;
  power?: PowerPart;
  battery?: BatteryPart;
  propulsion?: PropulsionPart;
  adcs?: AdcsPart;
  computer?: ComputerPart;
  comms?: CommsPart;
  thermal?: ThermalPart;
  mobility?: MobilityPart;
  landing?: LandingPart;
  instruments: InstrumentPart[];
  vehicle?: LaunchVehicle;
  transfer?: TransferOption;
  site?: LandingSite;
  /** Every measurement tag the chosen instruments provide. */
  measures: ReadonlySet<string>;
}

function partInSlot<C extends SlotId>(
  design: MissionDesign,
  scenario: Scenario,
  slot: C,
): Extract<Part, { category: C }> | undefined {
  const id = design.slots[slot];
  if (!id || !scenario.catalog.includes(id)) return undefined;
  const part = findPart(id);
  return part?.category === slot ? (part as Extract<Part, { category: C }>) : undefined;
}

export function resolveDesign(design: MissionDesign): ResolvedDesign {
  const scenario = getScenario(design.scenarioId);
  const instruments: InstrumentPart[] = [];
  for (const id of design.instruments) {
    const part = scenario.catalog.includes(id) ? findPart(id) : undefined;
    if (part?.category === 'instrument' && !instruments.includes(part)) instruments.push(part);
  }
  const { launchVehicleId, transferId, siteId } = design.trajectory;
  return {
    design,
    scenario,
    tier: getTier(design.tier),
    bus: partInSlot(design, scenario, 'bus'),
    power: partInSlot(design, scenario, 'power'),
    battery: partInSlot(design, scenario, 'battery'),
    propulsion: partInSlot(design, scenario, 'propulsion'),
    adcs: partInSlot(design, scenario, 'adcs'),
    computer: partInSlot(design, scenario, 'computer'),
    comms: partInSlot(design, scenario, 'comms'),
    thermal: partInSlot(design, scenario, 'thermal'),
    mobility: partInSlot(design, scenario, 'mobility'),
    landing: partInSlot(design, scenario, 'landing'),
    instruments,
    vehicle:
      launchVehicleId && scenario.launchVehicles.includes(launchVehicleId)
        ? getLaunchVehicle(launchVehicleId)
        : undefined,
    transfer: scenario.transfers.find((transfer) => transfer.id === transferId),
    site: scenario.sites.find((site) => site.id === siteId),
    measures: new Set(instruments.flatMap((instrument) => instrument.measures)),
  };
}

export function isRedundant(resolved: ResolvedDesign, slot: SlotId): boolean {
  return resolved.design.redundant.includes(slot);
}

export interface InstalledPart {
  /** The slot it sits in, or 'instrument'. */
  slot: SlotId | 'instrument';
  part: Part;
  /** Mass and cost after the redundancy factors; equal to the part's own when not redundant. */
  massKg: number;
  costMusd: number;
  /** Failure rate per year after redundancy. */
  failureRatePerYear: number;
}

/** Every part on the vehicle with redundancy already applied to its mass, cost and failure rate. */
export function installedParts(resolved: ResolvedDesign): InstalledPart[] {
  const { massFactor, costFactor, failureFactor } = MISSION_CONSTANTS.redundancy;
  const installed: InstalledPart[] = [];
  for (const slot of SLOT_IDS) {
    const part = resolved[slot];
    if (!part) continue;
    const redundant = isRedundant(resolved, slot);
    installed.push({
      slot,
      part,
      massKg: part.massKg * (redundant ? massFactor : 1),
      costMusd: part.costMusd * (redundant ? costFactor : 1),
      failureRatePerYear: part.failureRatePerYear * (redundant ? failureFactor : 1),
    });
  }
  for (const part of resolved.instruments) {
    installed.push({
      slot: 'instrument',
      part,
      massKg: part.massKg,
      costMusd: part.costMusd,
      failureRatePerYear: part.failureRatePerYear,
    });
  }
  return installed;
}

/** Parts of the scenario catalog a player of this tier may put in `category`. */
export function availableParts(scenario: Scenario, tier: TierId, category: Part['category']): Part[] {
  const parts: Part[] = [];
  for (const id of scenario.catalog) {
    const part = findPart(id);
    if (part && part.category === category && tierAllows(tier, part.minTier)) parts.push(part);
  }
  return parts;
}
