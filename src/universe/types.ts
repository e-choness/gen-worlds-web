// Gen Worlds © 2026 Echo Yin. PolyForm Noncommercial 1.0.0: see LICENSE.md.
/**
 * Pure data descriptions of everything in the universe. No rendering types here: these objects are
 * produced deterministically from seeds, are structured-cloneable (they cross into workers), and are
 * the single source of truth that renderers, the scanner UI and gameplay all read.
 *
 * Units are SI (metres, kilograms, seconds, kelvin) unless a field name says otherwise.
 */

import type { BiomeMap } from './biome';

export type Vec3Tuple = [number, number, number];

export type StarClass = 'O' | 'B' | 'A' | 'F' | 'G' | 'K' | 'M' | 'WD' | 'NS' | 'BH';

export interface StarDesc {
  /** Stable identity: galaxy seed + sector + index. */
  id: string;
  seed: number;
  name: string;
  class: StarClass;
  /** e.g. "G2V". */
  spectralType: string;
  temperatureK: number;
  radius: number;
  massSolar: number;
  luminositySolar: number;
  /** Linear-sRGB blackbody tint, normalised so the brightest channel is 1. */
  color: Vec3Tuple;
  /** Position in the galaxy, light-years from the galactic centre. */
  positionLy: Vec3Tuple;
  ageGyr: number;
}

export type PlanetKind =
  | 'barren' // airless, cratered
  | 'desert' // thin/dusty atmosphere, dunes and canyons
  | 'terra' // oceans, vegetation, weather
  | 'ocean' // global ocean with archipelagos
  | 'ice' // frozen surface, cryo-terrain
  | 'lava' // molten surface, volcanism
  | 'toxic' // thick opaque atmosphere, Venus/Titan-like
  | 'gasGiant'
  | 'iceGiant';

export interface AtmosphereDesc {
  /** Height of the top of the atmosphere above the datum radius. */
  height: number;
  /** Rayleigh scattering coefficient at the surface, per metre, RGB. */
  rayleigh: Vec3Tuple;
  rayleighScaleHeight: number;
  /** Mie scattering coefficient at the surface, per metre. */
  mie: number;
  mieScaleHeight: number;
  /** Mie absorption as a fraction of scattering, tinted (dust colour). */
  mieAbsorption: Vec3Tuple;
  /** Henyey–Greenstein anisotropy. */
  mieG: number;
  /** Absorbing layer (ozone-like), per metre, RGB. */
  absorption: Vec3Tuple;
  surfacePressureBar: number;
  composition: Array<{ gas: string; fraction: number }>;
}

export interface CloudDesc {
  coverage: number;
  /** Altitude of the cloud base and thickness of the layer. */
  baseHeight: number;
  thickness: number;
  color: Vec3Tuple;
  /** Storm cells / cyclones strength 0..1. */
  storminess: number;
}

export interface OceanDesc {
  /** Liquid name for the scanner: water, methane, lava, ammonia… */
  liquid: string;
  shallowColor: Vec3Tuple;
  deepColor: Vec3Tuple;
  /** 1 for water-like waves, lower for viscous liquids. */
  waveScale: number;
  /** Emissive strength (lava). */
  emissive: number;
}

export interface RingDesc {
  innerRadius: number;
  outerRadius: number;
  color: Vec3Tuple;
  opacity: number;
  seed: number;
}

/** Parameters of the procedural height field. See `universe/terrain-field.ts`. */
export interface TerrainDesc {
  seed: number;
  /** Characteristic wavelength of continents, metres. */
  continentScale: number;
  /** Shifts the land/sea balance: >0 more land. */
  continentBias: number;
  /** Height of continental plateaus above the datum and depth of basins below it. */
  continentHeight: number;
  basinDepth: number;
  mountainHeight: number;
  mountainScale: number;
  /** 0 = rolling, 1 = knife-edge ridges. */
  ridgeSharpness: number;
  hillHeight: number;
  /** Derivative damping of detail octaves: fakes fluvial erosion. */
  erosion: number;
  /** Domain-warp strength (fraction of continent scale). */
  warp: number;
  craterDensity: number;
  craterDepth: number;
  duneHeight: number;
  canyonDepth: number;
  /** Terracing for mesa / stratified looks, 0..1. */
  terrace: number;
  /** Small-scale roughness amplitude in metres at 100 m wavelength. */
  roughness: number;
}

/** Colours of the surface layers; the terrain shader blends them by height, slope and climate. */
export interface SurfacePalette {
  lowland: Vec3Tuple;
  midland: Vec3Tuple;
  highland: Vec3Tuple;
  rock: Vec3Tuple;
  cliff: Vec3Tuple;
  sand: Vec3Tuple;
  snow: Vec3Tuple;
  vegetation: Vec3Tuple;
  /** Emissive tint for lava cracks / bioluminescence, zero if none. */
  emissive: Vec3Tuple;
}

export interface LifeDesc {
  /** 0 none, 1 microbial, 2 flora, 3 flora and fauna. */
  level: 0 | 1 | 2 | 3;
  vegetationDensity: number;
  description: string;
}

export interface ResourceDeposit {
  name: string;
  symbol: string;
  /** 0..1 relative abundance. */
  abundance: number;
}

export interface BodyDesc {
  id: string;
  seed: number;
  name: string;
  kind: PlanetKind;
  /** Index path within the system: planet index, optionally moon index. */
  parentId: string | null;
  radius: number;
  massEarths: number;
  /** Surface gravity, m/s². */
  gravity: number;
  /** Orbit around the parent (star or planet). */
  orbitRadius: number;
  orbitPhase: number;
  orbitInclination: number;
  orbitalPeriodDays: number;
  axialTilt: number;
  /** Unit spin axis in system space (tilted from +Y by `axialTilt`). Latitude, bands and rings follow it. */
  axis: Vec3Tuple;
  dayLengthHours: number;
  /** Mean surface temperature. */
  temperatureK: number;
  atmosphere: AtmosphereDesc | null;
  clouds: CloudDesc | null;
  ocean: OceanDesc | null;
  rings: RingDesc | null;
  terrain: TerrainDesc;
  palette: SurfacePalette;
  /** Regions of the surface and the climate grid that selects them. */
  biomes: BiomeMap;
  /** Latitude (0..1 of the way to the pole) above which ice dominates; >1 means no caps. */
  iceLine: number;
  /** Altitude above which snow lies at the equator, metres; Infinity for none. */
  snowLine: number;
  life: LifeDesc;
  resources: ResourceDeposit[];
  /** Named phenomena present: aurora, lightning, dust storms, volcanism, geysers… */
  phenomena: string[];
  /** Gas giant band colours (only for gas/ice giants). */
  bands: Vec3Tuple[] | null;
  moons: BodyDesc[];
}

export interface SystemDesc {
  star: StarDesc;
  planets: BodyDesc[];
  /** True for the real solar system: body positions follow the ephemeris, not `orbitPhase`. */
  real?: boolean;
}
