/**
 * The bridge from the galaxy to the mission model: what a mission needs to know about a generated
 * body, and a way to find landable worlds without the 3D view.
 */
import { Rng } from '@/core/random';
import type { WorldParams } from '@/data/world';
import { AU } from './constants';
import { Galaxy, makeStar } from './galaxy';
import { generateSystem } from './system';
import type { BodyDesc, StarDesc, SystemDesc } from './types';

/** Surface classes a rover can land and drive on. */
const LANDABLE = new Set(['terra', 'desert', 'barren', 'ice', 'toxic', 'lava']);

export function isLandable(body: BodyDesc): boolean {
  return LANDABLE.has(body.kind);
}

/** The mission facts of `body`. A moon takes its sunlight from its planet's orbit. */
export function worldParamsOf(system: SystemDesc, body: BodyDesc): WorldParams {
  const parent = system.planets.find((planet) => planet.id === body.parentId);
  const orbitAu = (parent ?? body).orbitRadius / AU;
  const { star } = system;
  return {
    name: body.name,
    kind: body.kind,
    gravityMS2: body.gravity,
    radiusKm: body.radius / 1000,
    dayHours: body.dayLengthHours,
    pressureBar: body.atmosphere?.surfacePressureBar ?? 0,
    temperatureK: body.temperatureK,
    solarFlux: star.luminositySolar / (orbitAu * orbitAu),
    axialTiltDeg: (body.axialTilt * 180) / Math.PI,
    address: {
      starSeed: star.seed,
      starId: star.id,
      positionLy: [star.positionLy[0], star.positionLy[1], star.positionLy[2]],
      bodyId: body.id,
    },
  };
}

/** The system a world's address points at, generated again from its star. */
export function systemOfWorld(params: WorldParams): SystemDesc {
  const { starSeed, starId, positionLy } = params.address;
  return generateSystem(makeStar(starSeed, starId, positionLy));
}

/** Sector the search for worlds starts from: the same neighbourhood the sandbox opens in. */
const HOME_SECTOR = [2180, 1, 20] as const;
const SEARCH_RADIUS = 6;

function landableBodies(star: StarDesc): { system: SystemDesc; body: BodyDesc }[] {
  const system = generateSystem(star);
  const bodies = system.planets.flatMap((planet) => [planet, ...planet.moons]);
  return bodies.filter(isLandable).map((body) => ({ system, body }));
}

/**
 * A landable world of the galaxy chosen by `seed`: the same seed always gives the same world.
 * Walks sectors outward from the home neighbourhood from a seeded starting offset.
 */
export function pickWorld(seed: number): WorldParams {
  const rng = new Rng(seed);
  const galaxy = new Galaxy();
  for (let attempt = 0; attempt < 64; attempt++) {
    const sector = [
      HOME_SECTOR[0] + rng.int(-SEARCH_RADIUS, SEARCH_RADIUS),
      HOME_SECTOR[1] + rng.int(-1, 1),
      HOME_SECTOR[2] + rng.int(-SEARCH_RADIUS, SEARCH_RADIUS),
    ];
    const stars = galaxy.sectorStars(sector[0], sector[1], sector[2]);
    if (stars.length === 0) continue;
    const worlds = landableBodies(stars[rng.int(0, stars.length - 1)]);
    if (worlds.length === 0) continue;
    const { system, body } = worlds[rng.int(0, worlds.length - 1)];
    return worldParamsOf(system, body);
  }
  throw new Error('No landable world was found near the home sector.');
}
