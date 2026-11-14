// Gen Worlds © 2026 Echo Yin. PolyForm Noncommercial 1.0.0: see LICENSE.md.
/**
 * Regions of a world. Every solid body gets a small set of biomes derived from what it is (class,
 * temperature, life, chemistry) and a lookup grid over two climate coordinates:
 *
 *   t  temperature index, 0 frozen … 1 hot: falls from the equator to the poles and with altitude
 *   w  wetness / province index, 0..1: the body's slow "moisture" noise field
 *
 * The same grid drives the terrain shader (colours and ground cover, sampled as a texture), the
 * scanner (region names), surface scatter (what grows or stands there) and weather particles, so
 * what the instruments report is what is drawn.
 */
import type { Rng } from '@/core/random';
import { hex, hsl, mixColor, scaleColor } from './color';
import type { BodyDesc, LifeDesc, OceanDesc, PlanetKind, SurfacePalette, Vec3Tuple } from './types';

/** Grid resolution along each climate axis. */
export const BIOME_GRID = 16;

export type GroundCover = 'soil' | 'grass' | 'sand' | 'snow';
export type FloraKind = 'none' | 'tree' | 'mushroom' | 'crystal' | 'spire';
export type WeatherKind = 'none' | 'snow' | 'dust' | 'ash' | 'spores' | 'rain';

export interface BiomeDesc {
  name: string;
  description: string;
  /** Linear albedo of the ground. */
  color: Vec3Tuple;
  cover: GroundCover;
  flora: FloraKind;
  /** 0..1 density of `flora`. */
  floraDensity: number;
  /** Multiplier on boulder density. */
  rocks: number;
  /** 0..1 glow of the ground itself (embers, bioluminescence). */
  emissive: number;
  weather: WeatherKind;
}

export interface ClimateDesc {
  /** Temperature index at the equator at datum altitude. */
  equator: number;
  /** Drop in the index from equator to pole. */
  latitudeDrop: number;
  /** Altitude gain that lowers the index by 1, metres. */
  lapseHeight: number;
}

export interface BiomeMap {
  biomes: BiomeDesc[];
  /** `BIOME_GRID`² biome indices; row = temperature (cold first), column = wetness (dry first). */
  grid: number[];
  climate: ClimateDesc;
}

/** Climate coordinates of a surface point. `sinLat` is relative to the spin axis. */
export function climateAt(
  climate: ClimateDesc,
  sinLat: number,
  height: number,
  moisture: number,
): { t: number; w: number } {
  const t =
    climate.equator - climate.latitudeDrop * sinLat * sinLat - Math.max(height, 0) / climate.lapseHeight;
  return { t: Math.min(1, Math.max(0, t)), w: Math.min(1, Math.max(0, moisture)) };
}

export function biomeAt(map: BiomeMap, t: number, w: number): BiomeDesc {
  const row = Math.min(BIOME_GRID - 1, Math.floor(t * BIOME_GRID));
  const col = Math.min(BIOME_GRID - 1, Math.floor(w * BIOME_GRID));
  return map.biomes[map.grid[row * BIOME_GRID + col]];
}

/** Region at a point of `body` given its direction, height and moisture. */
export function regionAt(
  body: BodyDesc,
  dir: { x: number; y: number; z: number },
  height: number,
  moisture: number,
): BiomeDesc {
  const sinLat = dir.x * body.axis[0] + dir.y * body.axis[1] + dir.z * body.axis[2];
  const c = climateAt(body.biomes.climate, sinLat, height, moisture);
  return biomeAt(body.biomes, c.t, c.w);
}

interface BiomeInput {
  rng: Rng;
  kind: PlanetKind;
  palette: SurfacePalette;
  life: LifeDesc;
  ocean: OceanDesc | null;
  temperatureK: number;
  hasAtmosphere: boolean;
}

type Classifier = (t: number, w: number) => number;

const biome = (
  name: string,
  description: string,
  color: Vec3Tuple,
  options: Partial<Omit<BiomeDesc, 'name' | 'description' | 'color'>> = {},
): BiomeDesc => ({
  name,
  description,
  color,
  cover: 'soil',
  flora: 'none',
  floraDensity: 0,
  rocks: 1,
  emissive: 0,
  weather: 'none',
  ...options,
});

export function makeBiomes(input: BiomeInput): BiomeMap {
  const { rng, kind } = input;
  // Boundaries wander a little from world to world so no two share the same banding.
  const j = () => rng.range(-0.05, 0.05);
  let set: { biomes: BiomeDesc[]; classify: Classifier; climate: ClimateDesc };
  switch (kind) {
    case 'terra':
    case 'ocean':
      set = input.life.level >= 2 ? livingWorld(input, j) : sterileWorld(input, j);
      break;
    case 'desert':
      set = desertWorld(input, j);
      break;
    case 'ice':
      set = iceWorld(input, j);
      break;
    case 'lava':
      set = lavaWorld(input, j);
      break;
    case 'toxic':
      set = toxicWorld(input, j);
      break;
    default:
      set = barrenWorld(input, j);
  }
  if (!input.hasAtmosphere) for (const b of set.biomes) b.weather = 'none';

  // Real provinces share dust and weathering products: pull every region part of the way toward the
  // world's average so they read as one planet rather than a painted map.
  const average: Vec3Tuple = [0, 0, 0];
  for (const b of set.biomes) for (let c = 0; c < 3; c++) average[c] += b.color[c] / set.biomes.length;
  const blend = kind === 'terra' || kind === 'ocean' ? 0.12 : 0.34;
  for (const b of set.biomes) if (b.cover !== 'snow') b.color = mixColor(b.color, average, blend);

  const grid: number[] = [];
  for (let row = 0; row < BIOME_GRID; row++) {
    for (let col = 0; col < BIOME_GRID; col++) {
      grid.push(set.classify((row + 0.5) / BIOME_GRID, (col + 0.5) / BIOME_GRID));
    }
  }
  return { biomes: set.biomes, grid, climate: set.climate };
}

/** Mean ground colour over the grid: what the world looks like as a dot. */
export function meanBiomeColor(map: BiomeMap): Vec3Tuple {
  const sum: Vec3Tuple = [0, 0, 0];
  for (const index of map.grid) {
    const c = map.biomes[index].color;
    sum[0] += c[0];
    sum[1] += c[1];
    sum[2] += c[2];
  }
  return scaleColor(sum, 1 / map.grid.length);
}

function livingWorld(input: BiomeInput, j: () => number) {
  const { rng, palette, temperatureK } = input;
  const v = palette.vegetation;
  // Most biospheres are tree-like; some are fungal, which changes both the look and the names.
  const fungal = rng.chance(0.22);
  const flora: FloraKind = fungal ? 'mushroom' : 'tree';
  const forest = fungal ? 'Fungal forest' : 'Temperate forest';
  const dry = mixColor(palette.sand, palette.midland, 0.4);
  const biomes = [
    biome('Ice sheet', 'Permanent ice kilometres thick.', palette.snow, {
      cover: 'snow',
      weather: 'snow',
      rocks: 0.3,
    }),
    biome('Tundra', 'Frozen ground with lichen-like mats.', mixColor(palette.highland, v, 0.3), {
      cover: 'grass',
      weather: 'snow',
      rocks: 1.4,
    }),
    biome(fungal ? 'Sporecap taiga' : 'Boreal forest', 'Dense cold-adapted growth.', scaleColor(v, 0.75), {
      cover: 'grass',
      flora,
      floraDensity: 0.7,
    }),
    biome('Cold steppe', 'Dry, wind-scoured grass and gravel.', mixColor(dry, v, 0.25), {
      cover: 'grass',
      rocks: 1.5,
      weather: 'dust',
    }),
    biome(forest, 'Closed canopy over deep soil.', v, {
      cover: 'grass',
      flora,
      floraDensity: 0.85,
      weather: 'spores',
    }),
    biome(
      'Grassland',
      'Open plains of low photosynthesisers.',
      mixColor(scaleColor(v, 1.7), palette.sand, 0.25),
      {
        cover: 'grass',
        flora,
        floraDensity: 0.06,
      },
    ),
    biome('Scrubland', 'Sparse hardy growth on thin soil.', mixColor(dry, v, 0.35), {
      flora,
      floraDensity: 0.04,
      rocks: 1.6,
    }),
    biome('Dune desert', 'Wind-driven sand with no surface water.', palette.sand, {
      cover: 'sand',
      rocks: 0.6,
      weather: 'dust',
    }),
    biome(
      'Savanna',
      'Seasonal grass with scattered tall growth.',
      mixColor(palette.sand, scaleColor(v, 1.6), 0.5),
      {
        cover: 'grass',
        flora,
        floraDensity: 0.16,
      },
    ),
    biome(
      fungal ? 'Mycelial jungle' : 'Rainforest',
      'Hot, saturated and crowded with life.',
      scaleColor(mixColor(v, [v[0] * 0.6, v[1] * 1.1, v[2] * 0.7], 0.5), 0.8),
      { cover: 'grass', flora, floraDensity: 1, weather: 'rain', rocks: 0.5 },
    ),
    biome(
      'Wetland',
      'Waterlogged ground and standing pools.',
      mixColor(scaleColor(v, 0.7), hex(0x3a2e20), 0.45),
      {
        cover: 'grass',
        flora,
        floraDensity: 0.3,
        rocks: 0.3,
        weather: 'spores',
      },
    ),
  ];
  const a = [0.12 + j(), 0.28 + j(), 0.46 + j(), 0.72 + j()];
  const b = [0.3 + j(), 0.5 + j(), 0.7 + j()];
  const classify: Classifier = (t, w) => {
    if (t < a[0]) return 0;
    if (t < a[1]) return w < b[0] ? 3 : 1;
    if (t < a[2]) return w < b[0] ? 3 : w < b[2] ? 2 : 10;
    if (t < a[3]) return w < b[0] - 0.05 ? 6 : w < b[1] ? 5 : 4;
    return w < b[0] ? 7 : w < b[1] ? 8 : w < b[2] ? 5 : 9;
  };
  return { biomes, classify, climate: temperateClimate(temperatureK) };
}

function sterileWorld(input: BiomeInput, j: () => number) {
  const { rng, palette, temperatureK } = input;
  const clay = hsl(rng.range(0.02, 0.09), 0.45, 0.28);
  const biomes = [
    biome('Ice sheet', 'Permanent ice kilometres thick.', palette.snow, {
      cover: 'snow',
      weather: 'snow',
      rocks: 0.3,
    }),
    biome(
      'Permafrost barrens',
      'Frost-shattered rock over frozen ground.',
      mixColor(palette.highland, palette.snow, 0.25),
      {
        rocks: 1.8,
        weather: 'snow',
      },
    ),
    biome('Basalt plains', 'Old lava flows, weathered dark.', scaleColor(palette.rock, 0.6), { rocks: 1.6 }),
    biome('Clay badlands', 'Gullied sediment in oxide colours.', clay, {
      rocks: 1.2,
      flora: 'spire',
      floraDensity: 0.12,
    }),
    biome('Salt pans', 'Evaporite crust where seas retreated.', hex(0xcfc8b8), { cover: 'sand', rocks: 0.3 }),
    biome('Dune field', 'Loose sand in transverse dunes.', palette.sand, {
      cover: 'sand',
      rocks: 0.5,
      weather: 'dust',
    }),
    biome('Mudflats', 'Dark silt left by tides and floods.', scaleColor(palette.lowland, 0.6), {
      rocks: 0.4,
      weather: 'rain',
    }),
    biome('Gravel plains', 'Wind-sorted stone pavement.', palette.midland, { rocks: 2 }),
  ];
  const a = [0.12 + j(), 0.3 + j()];
  const b = [0.2 + j(), 0.4 + j(), 0.6 + j(), 0.8 + j()];
  const classify: Classifier = (t, w) => {
    if (t < a[0]) return 0;
    if (t < a[1]) return 1;
    if (w < b[0]) return t > 0.65 ? 5 : 7;
    if (w < b[1]) return 3;
    if (w < b[2]) return 2;
    if (w < b[3]) return 7;
    return t > 0.6 ? 4 : 6;
  };
  return { biomes, classify, climate: temperateClimate(temperatureK) };
}

function temperateClimate(temperatureK: number): ClimateDesc {
  return {
    equator: Math.min(1, Math.max(0.35, 0.86 + (temperatureK - 288) / 60)),
    latitudeDrop: 0.82,
    lapseHeight: 9000,
  };
}

function desertWorld(input: BiomeInput, j: () => number) {
  const { rng, palette, temperatureK } = input;
  const oxide = hsl(rng.range(0.0, 0.05), 0.6, 0.22);
  const ochre = hsl(rng.range(0.08, 0.13), 0.6, 0.32);
  const cold = temperatureK < 265;
  const crystals = rng.chance(0.35);
  const biomes = [
    biome('Polar frost', 'Seasonal carbon-dioxide and water frost.', hex(0xdfe6ea), {
      cover: 'snow',
      weather: 'snow',
      rocks: 0.6,
    }),
    biome('Basalt field', 'Black volcanic rock strewn with boulders.', hex(0x17140f), { rocks: 2.6 }),
    biome('Dune sea', 'An erg of drifting sand hundreds of kilometres across.', palette.sand, {
      cover: 'sand',
      rocks: 0.3,
      weather: 'dust',
    }),
    biome('Gravel plain', 'Deflated desert pavement.', scaleColor(palette.lowland, 0.8), {
      rocks: 2.2,
      weather: 'dust',
    }),
    biome('Oxide badlands', 'Iron-stained layered rock cut into hoodoos.', oxide, {
      flora: 'spire',
      floraDensity: 0.3,
      rocks: 1.5,
    }),
    biome('Ochre mesas', 'Flat-topped stratified uplands.', ochre, {
      flora: 'spire',
      floraDensity: 0.08,
      rocks: 1.2,
    }),
    biome('Salt flats', 'A dry lake bed of bright evaporites.', hex(0xd8d2c4), {
      cover: 'sand',
      rocks: 0.15,
      flora: crystals ? 'crystal' : 'none',
      floraDensity: crystals ? 0.25 : 0,
    }),
  ];
  const b = [0.2 + j(), 0.44 + j(), 0.6 + j(), 0.8 + j()];
  const classify: Classifier = (t, w) => {
    if (cold && t < 0.16) return 0;
    if (w < b[0]) return 1;
    if (w < b[1]) return t > 0.4 ? 2 : 3;
    if (w < b[2]) return 4;
    if (w < b[3]) return 5;
    return 6;
  };
  return { biomes, classify, climate: { equator: 0.9, latitudeDrop: 0.8, lapseHeight: 14000 } };
}

function iceWorld(input: BiomeInput, j: () => number) {
  const { rng, palette } = input;
  const tholin = hsl(rng.range(0.02, 0.08), 0.5, 0.26);
  const blue = hsl(rng.range(0.5, 0.58), 0.5, 0.55);
  const biomes = [
    biome('Polar cap', 'Clean volatile ice, the brightest ground here.', hex(0xf6fbff), {
      cover: 'snow',
      weather: 'snow',
      rocks: 0.2,
    }),
    biome('Tholin flats', 'Ice stained red-brown by irradiated organics.', tholin, { rocks: 0.8 }),
    biome('Nitrogen-ice plains', 'Smooth convecting ice with polygonal cells.', palette.lowland, {
      cover: 'snow',
      rocks: 0.3,
      weather: 'snow',
    }),
    biome('Fractured terrain', 'Tectonic ridges and troughs in the ice shell.', hex(0x8a9bb0), {
      rocks: 2,
      flora: 'crystal',
      floraDensity: 0.12,
    }),
    biome('Blue-ice fields', 'Old compressed ice scoured clean, with penitente spikes.', blue, {
      cover: 'snow',
      flora: 'crystal',
      floraDensity: 0.45,
      rocks: 0.5,
    }),
    biome('Cryovolcanic deposits', 'Dark frozen slurry erupted from below.', hex(0x3a4048), { rocks: 1.8 }),
  ];
  const b = [0.24 + j(), 0.45 + j(), 0.62 + j(), 0.8 + j()];
  const classify: Classifier = (t, w) => {
    if (t < 0.2) return 0;
    if (w < b[0]) return 1;
    if (w < b[1]) return 2;
    if (w < b[2]) return 3;
    if (w < b[3]) return 4;
    return 5;
  };
  return { biomes, classify, climate: { equator: 0.75, latitudeDrop: 0.75, lapseHeight: 20000 } };
}

function lavaWorld(input: BiomeInput, j: () => number) {
  const { rng, palette } = input;
  const sulfur = hsl(rng.range(0.12, 0.16), 0.75, 0.33);
  const biomes = [
    biome('Ember fields', 'Thin crust over incandescent rock.', hex(0x2a0f08), {
      emissive: 0.7,
      rocks: 1.2,
      weather: 'ash',
    }),
    biome('Basalt plains', 'Fresh ropy lava, barely cooled.', palette.lowland, {
      rocks: 1.6,
      weather: 'ash',
    }),
    biome('Ash wastes', 'Deep drifts of volcanic ash.', hex(0x35322f), {
      cover: 'sand',
      rocks: 0.5,
      weather: 'ash',
    }),
    biome('Obsidian flats', 'Sheets of volcanic glass.', hex(0x0b0a0c), {
      rocks: 0.8,
      flora: 'crystal',
      floraDensity: 0.1,
    }),
    biome('Scoria highlands', 'Oxidised cinder cones and spatter ramparts.', hex(0x3e1d14), {
      rocks: 2.2,
      flora: 'spire',
      floraDensity: 0.22,
      weather: 'ash',
    }),
    biome('Sulfur fields', 'Fumarole deposits in yellow and orange.', sulfur, { rocks: 0.9, emissive: 0.05 }),
  ];
  const b = [0.2 + j(), 0.4 + j(), 0.55 + j(), 0.7 + j(), 0.86 + j()];
  const classify: Classifier = (_t, w) =>
    w < b[0] ? 0 : w < b[1] ? 1 : w < b[2] ? 2 : w < b[3] ? 3 : w < b[4] ? 4 : 5;
  return { biomes, classify, climate: { equator: 1, latitudeDrop: 0.4, lapseHeight: 30000 } };
}

function toxicWorld(input: BiomeInput, j: () => number) {
  const { rng, palette } = input;
  const sulfur = hsl(rng.range(0.11, 0.17), 0.6, 0.34);
  const biomes = [
    biome('Tar plains', 'Hydrocarbon residue pooled in the lowlands.', hex(0x14100b), {
      rocks: 0.5,
      weather: 'rain',
    }),
    biome('Acid-etched plateau', 'Rock pitted and fluted by corrosive rain.', palette.midland, {
      rocks: 1.4,
      weather: 'rain',
    }),
    biome('Sulfur flats', 'Bright condensate from the cloud deck.', sulfur, { cover: 'sand', rocks: 0.6 }),
    biome('Tessera highlands', 'Intensely folded, ancient crust.', scaleColor(palette.highland, 0.7), {
      rocks: 2.2,
      flora: 'spire',
      floraDensity: 0.18,
    }),
    biome('Salt crust', 'Pale chloride and sulfate deposits.', hex(0xb8b09a), { cover: 'sand', rocks: 0.4 }),
    biome('Lowland haze basin', 'Dense, still air over weathered rubble.', palette.lowland, {
      rocks: 1.2,
      weather: 'dust',
    }),
  ];
  const b = [0.18 + j(), 0.4 + j(), 0.56 + j(), 0.76 + j(), 0.88 + j()];
  const classify: Classifier = (_t, w) =>
    w < b[0] ? 0 : w < b[1] ? 1 : w < b[2] ? 2 : w < b[3] ? 3 : w < b[4] ? 4 : 5;
  return { biomes, classify, climate: { equator: 1, latitudeDrop: 0.3, lapseHeight: 30000 } };
}

function barrenWorld(input: BiomeInput, j: () => number) {
  const { rng, palette } = input;
  const base = palette.midland;
  // What stains the regolith: gives airless worlds a character beyond grey.
  const accent = rng.pick<[string, string, Vec3Tuple]>([
    ['Oxide-stained regolith', 'Iron oxides colour the dust rust-red.', hsl(0.03, 0.55, 0.22)],
    ['Sulfur deposits', 'Volcanic sulfur frost in yellows and oranges.', hsl(0.14, 0.75, 0.38)],
    ['Carbon sheets', 'Dark carbonaceous lag, among the blackest ground known.', hex(0x0a0a0b)],
    ['Olivine sands', 'Green-tinged mantle minerals exposed by impacts.', hsl(0.22, 0.3, 0.2)],
    ['Ice-rich regolith', 'Bright ground: water ice mixed into the dust.', hex(0xaab4bf)],
  ]);
  const biomes = [
    biome('Polar cold traps', 'Permanently shadowed ground holding frost.', hex(0xc9d2da), {
      cover: 'snow',
      flora: 'crystal',
      floraDensity: 0.2,
    }),
    biome('Maria', 'Dark basalt plains that flooded old basins.', scaleColor(base, 0.45), { rocks: 0.8 }),
    biome('Regolith plains', 'Impact-gardened dust metres deep.', base, { cover: 'sand', rocks: 1 }),
    biome('Highlands', 'Bright, heavily cratered ancient crust.', scaleColor(base, 1.45), { rocks: 1.6 }),
    biome('Ejecta blankets', 'Rubble thrown out by a young impact.', scaleColor(base, 1.8), { rocks: 3 }),
    biome(accent[0], accent[1], accent[2], { rocks: 1.2 }),
  ];
  const b = [0.22 + j(), 0.45 + j(), 0.66 + j(), 0.8 + j()];
  const classify: Classifier = (t, w) => {
    if (t < 0.08) return 0;
    if (w < b[0]) return 1;
    if (w < b[1]) return 2;
    if (w < b[2]) return 3;
    if (w < b[3]) return 5;
    return 4;
  };
  return { biomes, classify, climate: { equator: 0.9, latitudeDrop: 0.85, lapseHeight: 40000 } };
}
