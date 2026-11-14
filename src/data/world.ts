// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0 or MIT: see LICENSE.md.
/**
 * A generated world as the mission model needs it. The galaxy's planets are procedural, so a mission
 * to one of them cannot come from a scenario file: instead the world's physical facts travel inside
 * the scenario id itself. Anything that holds the id (a design, a mission link, a co-op room, a
 * leaderboard entry) can rebuild the same body and the same scenario with no galaxy at hand.
 */
import type { BodyData } from '@/data/bodies';

export interface WorldParams {
  name: string;
  /** Surface class the galaxy drew it as ("desert", "barren", "ice"…). */
  kind: string;
  /** Surface gravity, m/s². */
  gravityMS2: number;
  radiusKm: number;
  dayHours: number;
  /** Surface pressure, bar; 0 for an airless world. */
  pressureBar: number;
  temperatureK: number;
  /** Sunlight at the world relative to sunlight at the Earth. */
  solarFlux: number;
  axialTiltDeg: number;
  /** Where the 3D view finds it again: the star it circles and the body's id in that system. */
  address: { starSeed: number; starId: string; positionLy: [number, number, number]; bodyId: string };
}

export const WORLD_PREFIX = 'world.';

const round = (value: number, digits: number): number => Number(value.toPrecision(digits));

/** The scenario id (and body id) of a generated world. Values are rounded so the id stays short. */
export function encodeWorld(params: WorldParams): string {
  const compact = [
    params.name,
    params.kind,
    round(params.gravityMS2, 3),
    round(params.radiusKm, 4),
    round(params.dayHours, 3),
    round(params.pressureBar, 2),
    Math.round(params.temperatureK),
    round(params.solarFlux, 3),
    Math.round(params.axialTiltDeg),
    params.address.starSeed,
    params.address.starId,
    params.address.positionLy,
    params.address.bodyId,
  ];
  const bytes = new TextEncoder().encode(JSON.stringify(compact));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return WORLD_PREFIX + btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export function isWorldId(id: string): boolean {
  return id.startsWith(WORLD_PREFIX);
}

const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** @throws when `id` is not a well-formed world id: ids arrive from links and other players. */
export function decodeWorld(id: string): WorldParams {
  const fail = (): never => {
    throw new Error('This link does not describe a world the game can rebuild.');
  };
  if (!isWorldId(id)) fail();
  let fields: unknown;
  try {
    const binary = atob(id.slice(WORLD_PREFIX.length).replaceAll('-', '+').replaceAll('_', '/'));
    fields = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0))));
  } catch {
    fail();
  }
  if (!Array.isArray(fields) || fields.length !== 13) fail();
  const [
    name,
    kind,
    gravity,
    radius,
    day,
    pressure,
    temperature,
    flux,
    tilt,
    seed,
    starId,
    position,
    bodyId,
  ] = fields as unknown[];
  const numbers = [gravity, radius, day, pressure, temperature, flux, tilt, seed];
  if (typeof name !== 'string' || typeof kind !== 'string' || !numbers.every(isNumber)) fail();
  if (typeof starId !== 'string' || typeof bodyId !== 'string') fail();
  if (!Array.isArray(position) || position.length !== 3 || !position.every(isNumber)) fail();
  // Physical values outside what a solid world can have would break the budgets: refuse them here.
  const positive = [gravity, radius, day, temperature, flux] as number[];
  if (positive.some((value) => value <= 0) || (pressure as number) < 0) fail();
  return {
    name: (name as string).slice(0, 40),
    kind: kind as string,
    gravityMS2: gravity as number,
    radiusKm: radius as number,
    dayHours: day as number,
    pressureBar: pressure as number,
    temperatureK: temperature as number,
    solarFlux: flux as number,
    axialTiltDeg: tilt as number,
    address: {
      starSeed: seed as number,
      starId: starId as string,
      positionLy: position as [number, number, number],
      bodyId: bodyId as string,
    },
  };
}

/** The body record the mission model reads gravity, size and day length from. */
export function worldBody(id: string, params: WorldParams): BodyData {
  const radiusM = params.radiusKm * 1000;
  const daySeconds = params.dayHours * 3600;
  return {
    id,
    name: params.name,
    parent: params.address.starId,
    mu: params.gravityMS2 * radiusM * radiusM,
    equatorialRadiusM: radiusM,
    surfaceGravityMS2: params.gravityMS2,
    j2: 0,
    siderealRotationS: daySeconds,
    solarDayS: daySeconds,
    // The mission model never asks a generated world for its year.
    yearS: 0,
    meanSolarDistanceAu: 1 / Math.sqrt(params.solarFlux),
    surfacePressurePa: params.pressureBar * 1e5,
    renderKind: params.kind,
    axialTiltDeg: params.axialTiltDeg,
    meanTemperatureK: params.temperatureK,
    atmosphereLayers: [],
  };
}
