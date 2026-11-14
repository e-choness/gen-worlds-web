// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
/**
 * Builds the surface-survey scenario of a generated world from its physical facts. Everything that
 * does not depend on the world (parts, rockets, operations) comes from a template scenario; the
 * derivations and their constants are in `world_scenario_rules.json`.
 */
import { camelize } from '@/data/camelize';
import type { LandingSite, Objective, Scenario, ScenarioTerms, TransferOption } from '@/data/scenarios';
import type { WorldParams } from '@/data/world';
import raw from '@/data/world_scenario_rules.json';

interface WorldRules {
  minEntryPressureBar: number;
  vacuumDescentFactor: number;
  insertionFraction: number;
  airDescentDeltaVMS: number;
  airTerminalDeltaVMS: number;
  vacuumTerminalDeltaVMS: number;
  referenceGravityMS2: number;
  vacuumReferenceGravityMS2: number;
  comfortTemperatureK: number;
  referenceColdK: number;
  minHeaterFactor: number;
  maxHeaterFactor: number;
  seasonFactor: number;
  carrierDistanceAu: number;
  carrierElongationDeg: number;
  landingLocalHour: number;
  budgetCapMusd: number;
  surfaceDurationDays: number;
  landingWindow: { startDate: string; endDate: string };
  landingDate: string;
  transfers: Omit<TransferOption, 'orbitInsertionDeltaVMS'>[];
  sites: Omit<LandingSite, 'horizonMaskDeg'>[];
  objectives: Pick<Objective, 'id' | 'name' | 'summary'>[];
  terms: ScenarioTerms;
  text: Record<string, string>;
}

export const WORLD_RULES: WorldRules = camelize<WorldRules>(raw);

const EARTH_GRAVITY_MS2 = 9.81;
/** Events that need air to happen. */
const AIR_EVENTS = new Set(['thin_air_on_entry', 'regional_dust_storm', 'dust_on_arrays']);
const FLAT_HORIZON = Array.from({ length: 12 }, () => 0);

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

function figure(value: number): string {
  return value >= 10 ? value.toFixed(0) : value >= 1 ? value.toFixed(1) : value.toPrecision(2);
}

function dayText(hours: number): string {
  return hours >= 72 ? `${figure(hours / 24)} Earth days` : `${figure(hours)} hours`;
}

/** The scenario for `params`, with `id` as both its own id and its target body's. */
export function buildWorldScenario(id: string, params: WorldParams, template: Scenario): Scenario {
  const rules = WORLD_RULES;
  const named = (text: string): string => text.replaceAll('{name}', params.name);
  const fact = (key: string, value: string): string => named(rules.text[key]).replace('{value}', value);
  const hasAir = params.pressureBar >= rules.minEntryPressureBar;
  const circularSpeed = Math.sqrt(params.gravityMS2 * params.radiusKm * 1000);
  const gravityScale = Math.sqrt(
    params.gravityMS2 / (hasAir ? rules.referenceGravityMS2 : rules.vacuumReferenceGravityMS2),
  );
  const cold =
    (rules.comfortTemperatureK - params.temperatureK) / (rules.comfortTemperatureK - rules.referenceColdK);
  const terms = Object.fromEntries(
    Object.entries(rules.terms).map(([key, value]) => [key, named(value)]),
  ) as unknown as ScenarioTerms;

  const briefing = [
    named(rules.text.briefingLead),
    fact('gravity', `${figure((params.gravityMS2 / EARTH_GRAVITY_MS2) * 100)} %`),
    fact('sunlight', `${figure(params.solarFlux * 100)} %`),
    fact('day', dayText(params.dayHours)),
    hasAir ? fact('air', figure(params.pressureBar)) : rules.text.noAir,
    fact('temperature', (params.temperatureK - 273.15).toFixed(0)),
  ].join(' ');

  return {
    ...template,
    id,
    number: 4,
    name: named(rules.text.name),
    tagline: rules.text.tagline,
    // The picture of a generated world is taken when the player plans the mission (see `ui/art.ts`).
    art: hasAir ? 'art/stage_mars.jpg' : 'art/stage_moon.jpg',
    stageArt: hasAir ? 'art/stage_mars.jpg' : 'art/stage_moon.jpg',
    briefing,
    trajectoryMode: 'lunar',
    targetBody: id,
    budgetCapMusd: rules.budgetCapMusd,
    surfaceDurationDays: rules.surfaceDurationDays,
    landingWindow: rules.landingWindow,
    transfers: rules.transfers.map((transfer) => ({
      ...transfer,
      // Air brakes the arrival; without it the engines capture into a low orbit first.
      orbitInsertionDeltaVMS: hasAir ? 0 : rules.insertionFraction * circularSpeed,
    })),
    route: null,
    orbit: null,
    entry: hasAir ? template.entry : null,
    sky: {
      model: 'local',
      equinoxLongitudeDeg: 0,
      landingLocalHour: rules.landingLocalHour,
      conjunctionElongationDeg: 0,
    },
    terms,
    descent: {
      ...template.descent,
      deltaVMS: hasAir ? rules.airDescentDeltaVMS * gravityScale : rules.vacuumDescentFactor * circularSpeed,
      terminalDeltaVMS: (hasAir ? rules.airTerminalDeltaVMS : rules.vacuumTerminalDeltaVMS) * gravityScale,
      summary: hasAir ? rules.text.descentAir : rules.text.descentVacuum,
    },
    environment: {
      ...template.environment,
      solarDistanceAu: 1 / Math.sqrt(params.solarFlux),
      earthDistanceAu: rules.carrierDistanceAu,
      heaterDemandShadowW:
        template.environment.heaterDemandShadowW * clamp(cold, rules.minHeaterFactor, rules.maxHeaterFactor),
      dustDegradationPerDay: hasAir ? template.environment.dustDegradationPerDay : 0,
    },
    operations: { ...template.operations, targetInShadow: false },
    sites: rules.sites.map((site) => ({ ...site, horizonMaskDeg: FLAT_HORIZON })),
    objectives: template.objectives.map((objective) => ({
      ...objective,
      ...rules.objectives.find((entry) => entry.id === objective.id),
    })),
    events: template.events.filter((event) => hasAir || !AIR_EVENTS.has(event)),
    referenceDesign: {
      ...template.referenceDesign,
      summary: rules.text.referenceSummary,
      transfer: rules.transfers[rules.transfers.length - 1].id,
      site: rules.sites[0].id,
      landingDate: rules.landingDate,
      departureDate: '',
      orbit: '',
    },
    nasaReference: {
      mission: rules.text.nasaMission,
      summary: rules.text.nasaSummary,
      url: rules.text.nasaUrl,
    },
  };
}
