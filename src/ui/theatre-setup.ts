// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
/** What the flight screen's 3D theatre needs to stage a flown mission: its vehicle and its worlds. */
import { getScenario } from '@/data/scenarios';
import { SURFACE_MAPS } from '@/data/surface-maps';
import type { MissionDesign } from '@/mission/design';
import { evaluateDesign } from '@/mission/evaluate-design';
import type { TimelinePhase } from '@/mission/timeline';
import type { TheatrePhase, TheatreSetup } from '@/render/theatre/mission-theatre';
import { vehicleSpecFromDesign } from '@/ui/vehicle-spec-from-design';

/** Display colours of the ground (sRGB hex): looks, not mission numbers. */
const GROUND_TINT: Readonly<Record<string, number>> = { moon: 0x8f8d88, mars: 0xa9643d, earth: 0x56604a };
const AIRLESS_TINT = 0x8f8d88;
const DUSTY_TINT = 0xa9643d;
/** A thin dusty daytime sky, as on Mars. */
const DUSTY_SKY = { horizon: 0xd8b48e, zenith: 0x8c6a55 } as const;

/** Seconds of coasting the 3D scene shows when the log has no cruise line of its own. */
export const COAST_SECONDS = 2.4;

const mapUrl = (body: string): string | null => {
  const entry = SURFACE_MAPS.find((map) => map.body === body);
  return entry ? import.meta.env.BASE_URL + entry.albedo : null;
};

export function theatreSetup(flown: MissionDesign): TheatreSetup {
  const scenario = getScenario(flown.scenarioId);
  const evaluation = evaluateDesign(flown);
  // An entry system is fitted only where there is air to slow down in.
  const hasAir = scenario.entry !== null;
  return {
    vehicle: vehicleSpecFromDesign(evaluation.resolved, evaluation.mass?.propellantKg ?? null),
    orbiter: scenario.orbit !== null,
    leavesEarth: scenario.targetBody !== 'earth',
    earthMapUrl: mapUrl('earth'),
    targetMapUrl: mapUrl(scenario.targetBody),
    groundTint: GROUND_TINT[scenario.targetBody] ?? (hasAir ? DUSTY_TINT : AIRLESS_TINT),
    sky: hasAir ? DUSTY_SKY : null,
    coastSeconds: COAST_SECONDS,
  };
}

/** The scene that goes with a line of the mission log (null: nothing revealed yet). */
export function theatrePhase(phase: TimelinePhase | null): TheatrePhase {
  switch (phase) {
    case 'launch':
      return 'launch';
    case 'cruise':
      return 'cruise';
    case 'landing':
      return 'arrival';
    case 'surface':
      return 'operations';
    default:
      return 'standby';
  }
}
