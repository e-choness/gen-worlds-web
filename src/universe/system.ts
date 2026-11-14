/**
 * Star system generation: orbits, planet classes, physical properties, atmospheres, surface
 * palettes, life and resources. Deterministic from the star's seed.
 */
import { hashCombine, Rng } from '@/core/random';
import { makeBiomes, meanBiomeColor } from './biome';
import { hex, hsl, mixColor, scaleColor } from './color';
import { AU, EARTH_GRAVITY, EARTH_RADIUS } from './constants';
import { moonName, planetName } from './names';
import type {
  AtmosphereDesc,
  BodyDesc,
  CloudDesc,
  LifeDesc,
  OceanDesc,
  PlanetKind,
  ResourceDeposit,
  RingDesc,
  StarDesc,
  SurfacePalette,
  SystemDesc,
  TerrainDesc,
  Vec3Tuple,
} from './types';

const EARTH_RAYLEIGH: Vec3Tuple = [5.802e-6, 13.558e-6, 33.1e-6];
const EARTH_OZONE: Vec3Tuple = [0.65e-6, 1.881e-6, 0.085e-6];

export function generateSystem(star: StarDesc): SystemDesc {
  const rng = new Rng(hashCombine(star.seed, 0x51573));
  const planets: BodyDesc[] = [];
  const lum = Math.max(star.luminositySolar, 1e-4);
  const compact = star.class === 'WD' || star.class === 'NS' || star.class === 'BH';
  const count = compact ? rng.int(0, 3) : rng.int(2, 8);
  const frostLineAu = 2.7 * Math.sqrt(lum);
  let orbitAu = rng.range(0.18, 0.45) * Math.sqrt(lum) + (compact ? 0.4 : 0);

  for (let i = 0; i < count; i++) {
    const equilibriumK = (278 * lum ** 0.25) / Math.sqrt(orbitAu);
    const kind = pickKind(rng, equilibriumK, orbitAu / frostLineAu);
    const name = planetName(star.name, i);
    const planet = makeBody({
      rng: rng.fork(i),
      id: `${star.id}/p${i}`,
      name,
      kind,
      parentId: null,
      orbitRadius: orbitAu * AU,
      equilibriumK,
      starMassSolar: star.massSolar,
    });
    planets.push(planet);
    orbitAu *= rng.range(1.45, 2.1);
  }
  return { star, planets };
}

function pickKind(rng: Rng, tempK: number, frostRatio: number): PlanetKind {
  if (frostRatio > 1) {
    const kinds: PlanetKind[] = ['gasGiant', 'iceGiant', 'ice', 'barren'];
    return kinds[rng.weighted([frostRatio < 4 ? 5 : 2, frostRatio < 4 ? 2 : 4, 2.5, 1])];
  }
  if (tempK > 900) return rng.chance(0.75) ? 'lava' : 'barren';
  if (tempK > 400) return (['desert', 'toxic', 'barren', 'lava'] as PlanetKind[])[rng.weighted([3, 3, 3, 1])];
  if (tempK > 225)
    return (['terra', 'ocean', 'desert', 'toxic', 'barren'] as PlanetKind[])[rng.weighted([5, 2.5, 2, 1, 1])];
  if (tempK > 140)
    return (['desert', 'ice', 'barren', 'gasGiant'] as PlanetKind[])[rng.weighted([3, 3, 2, 1])];
  return (['ice', 'barren'] as PlanetKind[])[rng.weighted([3, 1])];
}

export interface BodyInput {
  rng: Rng;
  id: string;
  name: string;
  kind: PlanetKind;
  parentId: string | null;
  orbitRadius: number;
  equilibriumK: number;
  starMassSolar: number;
  /** Set for moons: caps the size relative to the parent. */
  maxRadius?: number;
  /** Measured values of a real body, used in place of the generated ones. Such bodies get no generated moons. */
  fixed?: {
    radius: number;
    massEarths: number;
    gravity: number;
    temperatureK: number;
    /** Radians. */
    axialTilt: number;
    dayLengthHours: number;
    orbitalPeriodDays: number;
    rings: boolean;
    /** Measured surface pressure, bar: rocky worlds then get their real air instead of a drawn one. */
    surfacePressureBar?: number;
  };
}

/** Builds a body of a given class around measured values (see `BodyInput.fixed`). */
export function makeCatalogBody(input: BodyInput): BodyDesc {
  return makeBody(input);
}

function makeBody(input: BodyInput): BodyDesc {
  const { rng, kind } = input;
  const giant = kind === 'gasGiant' || kind === 'iceGiant';

  let massEarths: number;
  let radius: number;
  if (kind === 'gasGiant') {
    massEarths = rng.logRange(40, 900);
    radius = EARTH_RADIUS * rng.range(8, 12.5);
  } else if (kind === 'iceGiant') {
    massEarths = rng.logRange(8, 30);
    radius = EARTH_RADIUS * rng.range(3.4, 5);
  } else {
    massEarths = rng.logRange(kind === 'barren' ? 0.01 : 0.08, kind === 'barren' ? 0.6 : 4.5);
    radius = EARTH_RADIUS * massEarths ** 0.28;
  }
  if (input.maxRadius && radius > input.maxRadius) {
    radius = input.maxRadius * rng.range(0.5, 1);
    massEarths = (radius / EARTH_RADIUS) ** (1 / 0.28);
  }
  if (input.fixed) {
    radius = input.fixed.radius;
    massEarths = input.fixed.massEarths;
  }
  const gravity = input.fixed?.gravity ?? (EARTH_GRAVITY * massEarths) / (radius / EARTH_RADIUS) ** 2;

  const atmosphere = makeAtmosphere(
    rng.fork(1),
    kind,
    input.equilibriumK,
    gravity,
    radius,
    input.fixed?.surfacePressureBar,
  );
  const greenhouse = atmosphere
    ? 12 * Math.log1p(atmosphere.surfacePressureBar * 4) * (kind === 'toxic' ? 9 : 1)
    : 0;
  // Worlds classed as habitable are, by definition, the ones whose climate settled in the liquid-water range.
  const habitable = kind === 'terra' || kind === 'ocean';
  const generatedTemperatureK = habitable
    ? Math.min(Math.max(input.equilibriumK + greenhouse, 268), 308)
    : input.equilibriumK + greenhouse;
  const temperatureK = input.fixed?.temperatureK ?? generatedTemperatureK;

  const hue = rng.next();
  const palette = makePalette(rng.fork(2), kind, hue);
  const ocean = makeOcean(rng.fork(3), kind, temperatureK);
  const terrain = makeTerrain(rng.fork(4), kind, radius, gravity);
  const life = makeLife(rng.fork(5), kind, temperatureK);
  if (life.level >= 2)
    palette.vegetation = hsl(
      rng.pick([0.28, 0.33, 0.25, 0.3, 0.95, 0.75, 0.12, 0.5, 0.85, 0.03]) + rng.range(-0.03, 0.03),
      rng.range(0.4, 0.65),
      rng.range(0.16, 0.24),
    );

  const biomes = makeBiomes({
    rng: rng.fork(11),
    kind,
    palette,
    life,
    ocean,
    temperatureK,
    hasAtmosphere: atmosphere !== null,
  });
  // From afar a world shows the average of its regions.
  if (!giant) palette.midland = meanBiomeColor(biomes);

  const orbitalPeriodDays =
    input.fixed?.orbitalPeriodDays ?? 365.25 * Math.sqrt((input.orbitRadius / AU) ** 3 / input.starMassSolar);
  let rings = makeRings(rng.fork(7), kind, radius);
  if (input.fixed) {
    // Real bodies have rings or not as a matter of fact: retry the roll until it agrees.
    for (let attempt = 0; attempt < 32 && input.fixed.rings !== (rings !== null); attempt++) {
      rings = input.fixed.rings ? makeRings(rng.fork(700 + attempt), kind, radius) : null;
    }
  }
  // Ringed worlds get a visible tilt, otherwise the rings would always be edge-on to the star.
  const axialTilt = input.fixed?.axialTilt ?? Math.max(Math.abs(rng.gaussian(0, 0.35)), rings ? 0.22 : 0);
  const tiltAzimuth = rng.range(0, Math.PI * 2);
  const axis: Vec3Tuple = [
    Math.sin(axialTilt) * Math.cos(tiltAzimuth),
    Math.cos(axialTilt),
    Math.sin(axialTilt) * Math.sin(tiltAzimuth),
  ];
  const body: BodyDesc = {
    id: input.id,
    seed: rng.nextU32(),
    name: input.name,
    kind,
    parentId: input.parentId,
    radius,
    massEarths,
    gravity,
    orbitRadius: input.orbitRadius,
    orbitPhase: rng.range(0, Math.PI * 2),
    orbitInclination: rng.gaussian(0, 0.04),
    orbitalPeriodDays,
    axialTilt,
    axis,
    dayLengthHours: input.fixed?.dayLengthHours ?? (giant ? rng.range(9, 18) : rng.logRange(8, 200)),
    temperatureK,
    atmosphere,
    clouds: makeClouds(rng.fork(6), kind, atmosphere),
    ocean,
    rings,
    terrain,
    palette,
    biomes,
    iceLine:
      kind === 'ice'
        ? 0
        : kind === 'terra' || kind === 'ocean'
          ? clamp01(0.55 + (temperatureK - 265) / 90)
          : kind === 'desert' && temperatureK < 260
            ? 0.82
            : 2,
    snowLine:
      kind === 'terra'
        ? Math.max(800, 2500 + (temperatureK - 280) * 160)
        : kind === 'ocean'
          ? 4000
          : Number.POSITIVE_INFINITY,
    life,
    resources: makeResources(rng.fork(8), kind),
    phenomena: makePhenomena(rng.fork(9), kind, atmosphere, temperatureK),
    bands: giant ? makeBands(rng.fork(10), kind, hue) : null,
    moons: [],
  };

  // Moons: giants collect several large ones, rocky planets occasionally one or two.
  if (input.parentId === null && !input.fixed) {
    const moonCount = giant ? rng.int(1, 4) : rng.weighted([5, 3, 1]);
    let moonOrbit = radius * rng.range(giant ? 4 : 12, giant ? 7 : 30);
    for (let m = 0; m < moonCount; m++) {
      const moonKind: PlanetKind = (['barren', 'ice', 'desert', 'lava', 'ocean'] as PlanetKind[])[
        rng.weighted(input.equilibriumK < 200 ? [3, 5, 1, 1, 0.6] : [6, 1, 2, 1, 0.3])
      ];
      body.moons.push(
        makeBody({
          rng: rng.fork(100 + m),
          id: `${input.id}/m${m}`,
          name: moonName(input.name, m),
          kind: moonKind,
          parentId: input.id,
          orbitRadius: moonOrbit,
          equilibriumK: input.equilibriumK,
          starMassSolar: input.starMassSolar,
          maxRadius: Math.min(radius * 0.3, EARTH_RADIUS * 0.45),
        }),
      );
      moonOrbit *= rng.range(1.5, 2.2);
    }
  }
  return body;
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

function makeAtmosphere(
  rng: Rng,
  kind: PlanetKind,
  tempK: number,
  gravity: number,
  radius: number,
  measuredPressureBar?: number,
): AtmosphereDesc | null {
  if (kind === 'barren') return null;
  if (kind === 'ice' && rng.chance(0.55)) return null;
  if (kind === 'lava' && rng.chance(0.35)) return null;

  let pressure: number;
  let molarMass: number;
  let rayleigh: Vec3Tuple;
  let mie: number;
  let mieAbsorption: Vec3Tuple = [0.1, 0.1, 0.1];
  let absorption: Vec3Tuple = [0, 0, 0];
  let composition: AtmosphereDesc['composition'];
  let mieG = 0.8;

  switch (kind) {
    case 'terra':
    case 'ocean': {
      pressure = measuredPressureBar ?? rng.range(0.6, 2.2);
      molarMass = 29;
      // Mostly Earth-like, with occasional exotic chemistry that shifts the sky hue.
      const exotic = measuredPressureBar === undefined && rng.chance(0.3);
      rayleigh = exotic ? rotateSpectrum(EARTH_RAYLEIGH, rng.range(0.25, 1)) : EARTH_RAYLEIGH;
      absorption = scaleColor(EARTH_OZONE, rng.range(0.5, 1.5));
      mie = rng.range(2.5e-6, 7e-6);
      composition = [
        { gas: 'N₂', fraction: 0.74 },
        { gas: 'O₂', fraction: 0.21 },
        { gas: exotic ? 'Ne' : 'Ar', fraction: 0.04 },
        { gas: 'CO₂', fraction: 0.01 },
      ];
      break;
    }
    case 'desert': {
      pressure = measuredPressureBar ?? rng.logRange(0.01, 0.6);
      molarMass = 44;
      rayleigh = scaleColor(EARTH_RAYLEIGH, 1.3);
      // Suspended dust: strong forward scattering, absorbs blue → butterscotch day sky, blue sunsets.
      mie = rng.range(1.5e-5, 5e-5) / Math.max(pressure, 0.05);
      mieAbsorption = [0.08, 0.22, 0.55];
      mieG = 0.72;
      composition = [
        { gas: 'CO₂', fraction: 0.95 },
        { gas: 'N₂', fraction: 0.03 },
        { gas: 'Ar', fraction: 0.02 },
      ];
      break;
    }
    case 'toxic': {
      pressure = rng.logRange(3, 90);
      molarMass = 44;
      const tint = rng.pick<Vec3Tuple>([
        [0.02, 0.1, 0.5],
        [0.03, 0.25, 0.6],
        [0.4, 0.05, 0.3],
        [0.3, 0.02, 0.02],
      ]);
      rayleigh = scaleColor(EARTH_RAYLEIGH, 0.25);
      mie = rng.range(4e-6, 1.2e-5);
      mieAbsorption = tint;
      absorption = scaleColor(tint, 2e-6);
      mieG = 0.7;
      composition = [
        { gas: 'CO₂', fraction: 0.88 },
        { gas: 'SO₂', fraction: 0.07 },
        { gas: 'N₂', fraction: 0.05 },
      ];
      break;
    }
    case 'ice': {
      pressure = rng.logRange(0.02, 1.4);
      molarMass = 28;
      rayleigh = rotateSpectrum(EARTH_RAYLEIGH, rng.range(0, 0.4));
      absorption = [1.6e-6, 0.4e-6, 0.05e-6];
      mie = rng.range(1e-6, 6e-6);
      mieAbsorption = [0.05, 0.12, 0.3];
      composition = [
        { gas: 'N₂', fraction: 0.94 },
        { gas: 'CH₄', fraction: 0.05 },
        { gas: 'CO', fraction: 0.01 },
      ];
      break;
    }
    case 'lava': {
      pressure = rng.logRange(0.05, 3);
      molarMass = 50;
      rayleigh = scaleColor(EARTH_RAYLEIGH, 0.4);
      mie = rng.range(1e-5, 3e-5);
      mieAbsorption = [0.1, 0.35, 0.6];
      mieG = 0.65;
      composition = [
        { gas: 'SO₂', fraction: 0.7 },
        { gas: 'CO₂', fraction: 0.25 },
        { gas: 'Na', fraction: 0.05 },
      ];
      break;
    }
    case 'gasGiant': {
      pressure = 100;
      molarMass = 2.3;
      rayleigh = scaleColor(rotateSpectrum(EARTH_RAYLEIGH, rng.range(0, 0.3)), 0.6);
      mie = 2e-6;
      composition = [
        { gas: 'H₂', fraction: 0.89 },
        { gas: 'He', fraction: 0.1 },
        { gas: 'CH₄', fraction: 0.01 },
      ];
      break;
    }
    default: {
      // iceGiant: methane absorbs red → cyan / deep blue.
      pressure = 100;
      molarMass = 2.6;
      rayleigh = scaleColor(EARTH_RAYLEIGH, 0.9);
      absorption = [2.5e-6, 0.3e-6, 0.05e-6];
      mie = 1e-6;
      composition = [
        { gas: 'H₂', fraction: 0.82 },
        { gas: 'He', fraction: 0.15 },
        { gas: 'CH₄', fraction: 0.03 },
      ];
    }
  }

  const giant = kind === 'gasGiant' || kind === 'iceGiant';
  // Isothermal scale height H = kT / (μ g), expressed relative to Earth's ≈ 8.4 km.
  const scaleHeight = giant
    ? radius * 0.0035
    : Math.min(
        radius * 0.006,
        Math.max(3500, 8400 * (tempK / 288) * (EARTH_GRAVITY / gravity) * (29 / molarMass)),
      );
  // Optical depth scales with column mass; compress the range so thick atmospheres stay renderable.
  const density = giant ? 0.5 * (8400 / scaleHeight) : pressure ** 0.6 * (8400 / scaleHeight) ** 0.35;
  return {
    height: scaleHeight * 11,
    rayleigh: scaleColor(rayleigh, density),
    rayleighScaleHeight: scaleHeight,
    mie: mie * density,
    mieScaleHeight: scaleHeight * 0.15,
    mieAbsorption,
    mieG,
    absorption: scaleColor(absorption, density),
    surfacePressureBar: pressure,
    composition,
  };
}

/** Blends the Rayleigh spectrum toward a rotated one: 0 blue sky … 1 green/violet skies. */
function rotateSpectrum(base: Vec3Tuple, amount: number): Vec3Tuple {
  const rotated: Vec3Tuple =
    amount > 0.6 ? [base[1], base[2], base[0] * 2.5] : [base[0] * 1.5, base[2], base[1] * 1.4];
  return mixColor(base, rotated, Math.min(1, amount * 1.2));
}

function makePalette(rng: Rng, kind: PlanetKind, hue: number): SurfacePalette {
  const j = (c: Vec3Tuple, amt = 0.12): Vec3Tuple => {
    const k = 1 + rng.range(-amt, amt);
    return [
      c[0] * k * (1 + rng.range(-amt, amt) * 0.5),
      c[1] * k,
      c[2] * k * (1 + rng.range(-amt, amt) * 0.5),
    ];
  };
  const none: Vec3Tuple = [0, 0, 0];
  switch (kind) {
    case 'terra':
    case 'ocean':
      return {
        lowland: j(hex(0x4a5a2c)),
        midland: j(hex(0x6b6238)),
        highland: j(hex(0x6e6252)),
        rock: j(rng.pick([hex(0x5c554c), hex(0x4f4a4a), hex(0x6a5a4a), hex(0x3d3f44), hex(0x6b5148)])),
        cliff: j(hex(0x48423b)),
        // Quartz, coral-white, volcanic black, garnet-pink and olivine-green beaches all occur.
        sand: j(
          rng.pick([
            hex(0xc8b384),
            hex(0xc8b384),
            hex(0xe2d9c4),
            hex(0x2a2826),
            hex(0xc99a8a),
            hex(0x9aa076),
          ]),
        ),
        snow: hex(0xf2f6fa),
        vegetation: j(hex(0x2f4a1c)),
        emissive: none,
      };
    case 'desert': {
      // Mostly rust to ochre, sometimes pale, violet-grey or near black.
      const base = rng.pick([
        hsl(0.04 + hue * 0.09, 0.5, 0.42),
        hsl(0.04 + hue * 0.09, 0.5, 0.42),
        hsl(0.09 + hue * 0.04, 0.25, 0.6),
        hsl(0.78 + hue * 0.1, 0.14, 0.34),
        hsl(0.05, 0.2, 0.16),
        hsl(0.0 + hue * 0.03, 0.65, 0.3),
      ]);
      return {
        lowland: j(base),
        midland: j(mixColor(base, hex(0x8a5a3c), 0.5)),
        highland: j(mixColor(base, hex(0x5a3a2a), 0.6)),
        rock: j(hex(0x6a4634)),
        cliff: j(hex(0x4a2e22)),
        sand: j(mixColor(base, hex(0xd9a066), 0.6)),
        snow: hex(0xe8ecf0),
        vegetation: none,
        emissive: none,
      };
    }
    case 'ice': {
      // Blue-white, or tinted pink / tan / green by what is frozen into the ice.
      const tint = hsl(rng.pick([0.52, 0.56, 0.6, 0.95, 0.08, 0.4]) + hue * 0.06, rng.range(0.15, 0.4), 0.78);
      return {
        lowland: j(tint, 0.05),
        midland: j(hex(0xcfdbe6), 0.05),
        highland: j(hex(0xe9eff5), 0.04),
        rock: j(hex(0x5f6a78)),
        cliff: j(hex(0x7f95ad)),
        sand: j(hex(0xb9c7d6), 0.05),
        snow: hex(0xf7fbff),
        vegetation: none,
        emissive: none,
      };
    }
    case 'lava':
      return {
        lowland: j(hex(0x1c1614)),
        midland: j(hex(0x2a211e)),
        highland: j(hex(0x3a302c)),
        rock: j(hex(0x231c1a)),
        cliff: j(hex(0x15100f)),
        sand: j(hex(0x2e2623)),
        snow: hex(0x8a8480),
        vegetation: none,
        emissive: [1.0, 0.28, 0.04],
      };
    case 'toxic': {
      const base = hsl(0.08 + hue * 0.1, 0.4, 0.3);
      return {
        lowland: j(base),
        midland: j(mixColor(base, hex(0x6a5a3a), 0.5)),
        highland: j(hex(0x5a5248)),
        rock: j(hex(0x4a443c)),
        cliff: j(hex(0x34302a)),
        sand: j(hex(0x8a7a4a)),
        snow: hex(0xd8d2b8),
        vegetation: none,
        emissive: none,
      };
    }
    default: {
      // barren (and unused for giants): regolith greys with a faint mineral tint.
      const base = hsl(hue, 0.07, rng.range(0.22, 0.42));
      return {
        lowland: j(scaleColor(base, 0.75), 0.06),
        midland: j(base, 0.06),
        highland: j(scaleColor(base, 1.25), 0.06),
        rock: j(scaleColor(base, 0.9), 0.06),
        cliff: j(scaleColor(base, 0.6), 0.06),
        sand: j(scaleColor(base, 1.1), 0.06),
        snow: hex(0xe6e6e6),
        vegetation: none,
        emissive: none,
      };
    }
  }
}

function makeOcean(rng: Rng, kind: PlanetKind, tempK: number): OceanDesc | null {
  if (kind === 'terra' || kind === 'ocean') {
    // Mostly blue; dissolved minerals and plankton turn some seas teal, green or wine-dark.
    const sea = rng.pick([0.5, 0.5, 0.5, 0.46, 0.4, 0.34, 0.9]) + rng.range(-0.04, 0.05);
    return {
      liquid: 'Water',
      shallowColor: hsl(sea, 0.65, 0.3),
      deepColor: hsl(sea + 0.1, 0.75, 0.07),
      waveScale: 1,
      emissive: 0,
    };
  }
  if (kind === 'lava') {
    return {
      liquid: 'Molten silicate',
      shallowColor: [1, 0.35, 0.05],
      deepColor: [0.9, 0.12, 0.01],
      waveScale: 0.15,
      emissive: 6,
    };
  }
  if (kind === 'ice' && tempK < 120 && rng.chance(0.5)) {
    return {
      liquid: 'Liquid methane',
      shallowColor: hex(0x3a3324),
      deepColor: hex(0x0d0b07),
      waveScale: 0.4,
      emissive: 0,
    };
  }
  if (kind === 'toxic' && rng.chance(0.4)) {
    return {
      liquid: 'Sulfuric acid',
      shallowColor: hex(0x8a8a2a),
      deepColor: hex(0x2a2a08),
      waveScale: 0.7,
      emissive: 0,
    };
  }
  return null;
}

function makeTerrain(rng: Rng, kind: PlanetKind, radius: number, gravity: number): TerrainDesc {
  // Lower gravity supports taller relief.
  const relief = Math.min(3, (EARTH_GRAVITY / gravity) ** 0.6);
  const t: TerrainDesc = {
    seed: rng.nextU32(),
    continentScale: radius * rng.range(0.55, 1.1),
    continentBias: 0,
    continentHeight: 600 * relief,
    basinDepth: 3500 * relief,
    mountainHeight: rng.range(4000, 8000) * relief,
    mountainScale: rng.range(180e3, 420e3),
    ridgeSharpness: rng.range(0.55, 0.95),
    hillHeight: rng.range(250, 700) * relief,
    erosion: rng.range(0.5, 1.1),
    warp: rng.range(0.15, 0.4),
    craterDensity: 0,
    craterDepth: 0,
    duneHeight: 0,
    canyonDepth: 0,
    terrace: 0,
    roughness: rng.range(2, 5),
  };
  switch (kind) {
    case 'terra':
      t.continentBias = rng.range(-0.22, 0.08);
      t.canyonDepth = rng.chance(0.4) ? rng.range(300, 900) : 0;
      break;
    case 'ocean':
      t.continentBias = rng.range(-0.55, -0.35);
      t.mountainHeight *= 0.7;
      break;
    case 'desert':
      t.continentBias = 0.3;
      t.basinDepth = 2500 * relief;
      t.duneHeight = rng.range(25, 90);
      t.canyonDepth = rng.range(600, 2800);
      t.terrace = rng.range(0.2, 0.8);
      t.craterDensity = rng.range(0.05, 0.35);
      t.craterDepth = 0.5;
      t.erosion *= 0.7;
      break;
    case 'ice':
      t.continentBias = 0.2;
      t.mountainHeight *= 0.6;
      t.ridgeSharpness = rng.range(0.3, 0.7);
      t.canyonDepth = rng.range(200, 1500);
      t.craterDensity = rng.range(0.05, 0.3);
      t.craterDepth = 0.5;
      break;
    case 'lava':
      t.continentBias = rng.range(-0.15, 0.2);
      t.basinDepth = 1200 * relief;
      t.mountainHeight *= 0.8;
      t.erosion = 0.2;
      t.roughness = 7;
      break;
    case 'toxic':
      t.continentBias = 0.25;
      t.mountainHeight *= 0.75;
      t.erosion *= 0.6;
      t.terrace = rng.range(0, 0.4);
      break;
    case 'barren':
      t.continentBias = 0.1;
      t.continentHeight = 900 * relief;
      t.basinDepth = 2200 * relief;
      t.mountainHeight = rng.range(1500, 4500) * relief;
      t.ridgeSharpness = rng.range(0.2, 0.5);
      t.erosion = 0.1;
      t.craterDensity = rng.range(0.6, 1);
      t.craterDepth = 1;
      break;
    default:
      // Giants have no solid surface: a perfectly smooth datum sphere at the 1-bar level.
      t.continentHeight = 0;
      t.basinDepth = 0;
      t.mountainHeight = 0;
      t.hillHeight = 0;
      break;
  }
  return t;
}

function makeClouds(rng: Rng, kind: PlanetKind, atmosphere: AtmosphereDesc | null): CloudDesc | null {
  if (!atmosphere) return null;
  const h = atmosphere.rayleighScaleHeight;
  switch (kind) {
    case 'terra':
    case 'ocean':
      return {
        coverage: rng.range(0.35, 0.65),
        baseHeight: h * 0.22,
        thickness: h * 0.4,
        color: [1, 1, 1],
        storminess: rng.range(0.2, 0.8),
      };
    case 'toxic':
      return {
        coverage: rng.range(0.85, 1),
        baseHeight: h * 0.8,
        thickness: h * 0.9,
        color: hsl(rng.range(0.08, 0.16), 0.45, 0.72),
        storminess: rng.range(0.3, 1),
      };
    case 'desert':
      return rng.chance(0.5)
        ? {
            coverage: rng.range(0.08, 0.25),
            baseHeight: h * 0.6,
            thickness: h * 0.15,
            color: hex(0xf2e2cf),
            storminess: 0.1,
          }
        : null;
    case 'ice':
      return rng.chance(0.6)
        ? {
            coverage: rng.range(0.15, 0.5),
            baseHeight: h * 0.3,
            thickness: h * 0.25,
            color: hex(0xeef4fa),
            storminess: 0.3,
          }
        : null;
    case 'lava':
      return {
        coverage: rng.range(0.3, 0.6),
        baseHeight: h * 0.35,
        thickness: h * 0.5,
        color: hex(0x4a4442),
        storminess: 0.9,
      };
    default:
      return null;
  }
}

function makeRings(rng: Rng, kind: PlanetKind, radius: number): RingDesc | null {
  const chance =
    kind === 'gasGiant'
      ? 0.6
      : kind === 'iceGiant'
        ? 0.45
        : kind === 'barren' || kind === 'ice'
          ? 0.04
          : 0.02;
  if (!rng.chance(chance)) return null;
  const inner = radius * rng.range(1.25, 1.7);
  return {
    innerRadius: inner,
    outerRadius: inner + radius * rng.range(0.5, 1.4),
    color: hsl(rng.range(0.05, 0.14), rng.range(0.1, 0.4), rng.range(0.55, 0.8)),
    opacity: rng.range(0.5, 0.95),
    seed: rng.nextU32(),
  };
}

function makeBands(rng: Rng, kind: PlanetKind, hue: number): Vec3Tuple[] {
  const bands: Vec3Tuple[] = [];
  const base = kind === 'iceGiant' ? 0.5 + hue * 0.12 : rng.pick([0.07, 0.09, 0.11, 0.58, 0.02, 0.14]);
  const sat = kind === 'iceGiant' ? 0.45 : rng.range(0.25, 0.6);
  for (let i = 0; i < 6; i++) {
    bands.push(
      hsl(
        base + rng.range(-0.035, 0.035),
        sat * rng.range(0.5, 1.2),
        kind === 'iceGiant' ? rng.range(0.5, 0.7) : rng.range(0.3, 0.8),
      ),
    );
  }
  return bands;
}

function makeLife(rng: Rng, kind: PlanetKind, tempK: number): LifeDesc {
  if (kind === 'terra' && tempK > 255 && tempK < 325) {
    const level = rng.weighted([1, 2, 4, 4]) as 0 | 1 | 2 | 3;
    const text = [
      'No biosignatures detected',
      'Microbial mats in surface water',
      'Photosynthetic flora, no motile fauna',
      'Complex biosphere: flora and fauna',
    ];
    return { level, vegetationDensity: level >= 2 ? rng.range(0.4, 1) : 0, description: text[level] };
  }
  if ((kind === 'ocean' || kind === 'ice') && rng.chance(0.3)) {
    return {
      level: 1,
      vegetationDensity: 0,
      description:
        kind === 'ocean'
          ? 'Planktonic blooms in the photic zone'
          : 'Chemotrophs suspected under the ice shell',
    };
  }
  return { level: 0, vegetationDensity: 0, description: 'No biosignatures detected' };
}

const RESOURCE_POOL: Record<string, Array<[string, string]>> = {
  common: [
    ['Iron', 'Fe'],
    ['Silicon', 'Si'],
    ['Magnesium', 'Mg'],
    ['Aluminium', 'Al'],
    ['Nickel', 'Ni'],
  ],
  volatile: [
    ['Water ice', 'H₂O'],
    ['Methane', 'CH₄'],
    ['Ammonia', 'NH₃'],
    ['Nitrogen', 'N₂'],
    ['Carbon dioxide', 'CO₂'],
  ],
  rare: [
    ['Titanium', 'Ti'],
    ['Platinum', 'Pt'],
    ['Iridium', 'Ir'],
    ['Uranium', 'U'],
    ['Lithium', 'Li'],
    ['Helium-3', '³He'],
    ['Gold', 'Au'],
    ['Cobalt', 'Co'],
  ],
  gas: [
    ['Hydrogen', 'H₂'],
    ['Helium', 'He'],
    ['Deuterium', '²H'],
    ['Helium-3', '³He'],
  ],
};

function makeResources(rng: Rng, kind: PlanetKind): ResourceDeposit[] {
  const pick = (pool: Array<[string, string]>, n: number, lo: number, hi: number): ResourceDeposit[] => {
    const copy = [...pool];
    const out: ResourceDeposit[] = [];
    for (let i = 0; i < n && copy.length; i++) {
      const [name, symbol] = copy.splice(rng.int(0, copy.length - 1), 1)[0];
      out.push({ name, symbol, abundance: rng.range(lo, hi) });
    }
    return out;
  };
  if (kind === 'gasGiant' || kind === 'iceGiant') return pick(RESOURCE_POOL.gas, 3, 0.2, 1);
  const list = pick(RESOURCE_POOL.common, 3, 0.4, 1);
  if (kind === 'ice' || kind === 'ocean' || kind === 'terra')
    list.push(...pick(RESOURCE_POOL.volatile, 2, 0.3, 0.9));
  list.push(...pick(RESOURCE_POOL.rare, rng.int(1, 3), 0.02, 0.35));
  return list.sort((a, b) => b.abundance - a.abundance);
}

function makePhenomena(
  rng: Rng,
  kind: PlanetKind,
  atmosphere: AtmosphereDesc | null,
  tempK: number,
): string[] {
  const out: string[] = [];
  if (atmosphere && rng.chance(kind === 'gasGiant' || kind === 'iceGiant' ? 0.9 : 0.55)) out.push('Aurora');
  if (
    atmosphere &&
    (kind === 'terra' || kind === 'ocean' || kind === 'toxic' || kind === 'gasGiant' || kind === 'lava') &&
    rng.chance(0.7)
  )
    out.push('Lightning storms');
  if (kind === 'desert') out.push('Dust storms');
  if (kind === 'lava') out.push('Active volcanism');
  if (kind === 'ice' && rng.chance(0.5)) out.push('Cryo-geysers');
  if (kind === 'gasGiant') out.push('Cyclonic vortices');
  if (kind === 'terra' && tempK > 290 && rng.chance(0.4)) out.push('Tropical cyclones');
  if (kind === 'barren' && rng.chance(0.3)) out.push('Micrometeorite flux');
  return out;
}
