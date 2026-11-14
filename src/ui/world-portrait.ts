// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
/**
 * A picture of a generated world for the mission screens, drawn without the 3D engine.
 *
 * The world is rebuilt from its address, and its own height field, palette, sea, clouds and air
 * colour are sampled per pixel onto a lit disc, so the picture shows the same continents the player
 * would fly over. Used when no snapshot from the 3D view exists (a world picked from the list or
 * opened from a link). Drawn once per world and kept for the page's life.
 */
import { Noise3 } from '@/core/noise';
import { hash32 } from '@/core/random';
import type { WorldParams } from '@/data/world';
import { TerrainField } from '@/universe/terrain-field';
import type { BodyDesc, Vec3Tuple } from '@/universe/types';
import { systemOfWorld } from '@/universe/world-params';

const WIDTH = 640;
const HEIGHT = 360;
/** The disc sits right of centre, as the catalog pictures do, and fills most of the height. */
const DISC_X = 0.56 * WIDTH;
const DISC_Y = 0.5 * HEIGHT;
const DISC_RADIUS = 0.4 * HEIGHT;
/** Features smaller than this share of the radius cannot show at this size: skip their octaves. */
const DETAIL_SHARE = 0.006;
/** Slopes are drawn this many times steeper than they are: true relief is invisible from orbit. */
const RELIEF_EXAGGERATION = 14;
const MAX_DRAWN_SLOPE = 0.9;
const STAR_COUNT = 420;
/** How far the glow of the air is drawn, in disc radii; it fades to nothing there. */
const GLOW_REACH = 1.3;
/** Direction to the star in view space (x right, y up, z toward the viewer), unit length. */
const SUN: Vec3Tuple = [-0.58, 0.42, 0.7];
/** Display gain from the palette's linear reflectance to the screen. */
const EXPOSURE = 2.1;
const JPEG_QUALITY = 0.86;

const cache = new Map<string, string | null>();

/** Linear colour channel to an 8-bit sRGB value. */
function toScreen(linear: number): number {
  const clamped = Math.min(1, Math.max(0, linear));
  return Math.round(255 * clamped ** (1 / 2.2));
}

/** A soft shoulder instead of a hard clip, so bright ice and cloud keep their shape. */
function shoulder(linear: number): number {
  return 1 - Math.exp(-linear * 1.25);
}

function mix3(a: Vec3Tuple, b: Vec3Tuple, t: number): Vec3Tuple {
  const k = Math.min(1, Math.max(0, t));
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

function findBody(params: WorldParams): BodyDesc | null {
  const system = systemOfWorld(params);
  for (const planet of system.planets) {
    if (planet.id === params.address.bodyId) return planet;
    const moon = planet.moons.find((candidate) => candidate.id === params.address.bodyId);
    if (moon) return moon;
  }
  return null;
}

/** The colour of the air seen edge-on: the scattering colour, brightest channel at 1. */
function airColor(body: BodyDesc): Vec3Tuple | null {
  if (!body.atmosphere) return null;
  const [r, g, b] = body.atmosphere.rayleigh;
  const peak = Math.max(r, g, b);
  return peak > 0 ? [r / peak, g / peak, b / peak] : null;
}

function draw(body: BodyDesc, context: CanvasRenderingContext2D): void {
  const image = context.createImageData(WIDTH, HEIGHT);
  const pixels = image.data;
  const field = new TerrainField(body.terrain, body.radius);
  const cloudNoise = new Noise3(body.seed ^ 0x51ed270b);
  const palette = body.palette;
  const terrain = body.terrain;
  const air = airColor(body);
  // How strongly the air shows scales with how much of it there is, up to about one bar.
  const airStrength = body.atmosphere ? Math.min(1, 0.25 + body.atmosphere.surfacePressureBar) : 0;
  const relief = Math.max(1, terrain.continentHeight + terrain.mountainHeight * 0.5);
  const depth = Math.max(1, terrain.basinDepth);
  const minWavelength = body.radius * DETAIL_SHARE;
  const tilt = 0.35;
  const cosTilt = Math.cos(tilt);
  const sinTilt = Math.sin(tilt);
  const sunLength = Math.hypot(SUN[0], SUN[1], SUN[2]);
  const sx = SUN[0] / sunLength;
  const sy = SUN[1] / sunLength;
  const sz = SUN[2] / sunLength;

  // Stars: a fixed scatter per world, dim enough to stay behind the disc's glow.
  let state = hash32(body.seed);
  for (let i = 0; i < STAR_COUNT; i++) {
    state = hash32(state);
    const x = state % WIDTH;
    state = hash32(state);
    const y = state % HEIGHT;
    state = hash32(state);
    const level = 40 + (state % 150);
    const o = (y * WIDTH + x) * 4;
    pixels[o] = level;
    pixels[o + 1] = level;
    pixels[o + 2] = Math.min(255, level + 20);
  }
  for (let o = 3; o < pixels.length; o += 4) pixels[o] = 255;

  // First the heights of every pixel of the disc, so the shading below can read its neighbours'.
  const heights = new Float32Array(WIDTH * HEIGHT).fill(Number.NaN);
  for (let py = Math.floor(DISC_Y - DISC_RADIUS); py <= DISC_Y + DISC_RADIUS; py++) {
    const vy = (DISC_Y - py - 0.5) / DISC_RADIUS;
    for (let px = Math.floor(DISC_X - DISC_RADIUS); px <= DISC_X + DISC_RADIUS; px++) {
      const vx = (px + 0.5 - DISC_X) / DISC_RADIUS;
      const r2 = vx * vx + vy * vy;
      if (r2 >= 1 || py < 0 || py >= HEIGHT || px < 0 || px >= WIDTH) continue;
      const vz = Math.sqrt(1 - r2);
      // Tip the pole toward the viewer so a cap, if there is one, shows.
      heights[py * WIDTH + px] = field.height(
        vx,
        vy * cosTilt + vz * sinTilt,
        vz * cosTilt - vy * sinTilt,
        minWavelength,
      );
    }
  }
  const slopeScale = (RELIEF_EXAGGERATION * DISC_RADIUS) / (2 * body.radius);
  const drop = (a: number, b: number, floor: number): number => {
    if (Number.isNaN(a) || Number.isNaN(b)) return 0;
    const slope = (Math.max(a, floor) - Math.max(b, floor)) * slopeScale;
    return Math.min(MAX_DRAWN_SLOPE, Math.max(-MAX_DRAWN_SLOPE, slope));
  };
  // A sea is level: heights below it do not shade.
  const floor = body.ocean ? 0 : Number.NEGATIVE_INFINITY;

  const reach = DISC_RADIUS * GLOW_REACH;
  for (let py = Math.floor(DISC_Y - reach); py <= DISC_Y + reach; py++) {
    if (py < 0 || py >= HEIGHT) continue;
    const vy = (DISC_Y - py - 0.5) / DISC_RADIUS;
    for (let px = Math.floor(DISC_X - reach); px <= DISC_X + reach; px++) {
      if (px < 0 || px >= WIDTH) continue;
      const vx = (px + 0.5 - DISC_X) / DISC_RADIUS;
      const r2 = vx * vx + vy * vy;
      const o = (py * WIDTH + px) * 4;
      if (r2 >= 1) {
        if (!air) continue;
        // Air beyond the limb, on the lit side only.
        const r = Math.sqrt(r2);
        const glow =
          Math.exp(-(r - 1) * 30) *
          Math.max(0, 1 - (r - 1) / (GLOW_REACH - 1)) *
          Math.max(0, (vx * sx + vy * sy) / r + 0.3) *
          airStrength;
        pixels[o] = Math.min(255, pixels[o] + toScreen(air[0] * glow * 0.5));
        pixels[o + 1] = Math.min(255, pixels[o + 1] + toScreen(air[1] * glow * 0.5));
        pixels[o + 2] = Math.min(255, pixels[o + 2] + toScreen(air[2] * glow * 0.5));
        continue;
      }
      const vz = Math.sqrt(1 - r2);
      const dx = vx;
      const dy = vy * cosTilt + vz * sinTilt;
      const dz = vz * cosTilt - vy * sinTilt;
      const index = py * WIDTH + px;
      const height = heights[index];

      let color: Vec3Tuple;
      let glint = 0;
      const facing = vx * sx + vy * sy + vz * sz;
      // Relief: lean the surface against its slope before lighting it.
      const nx = vx - drop(heights[index + 1], heights[index - 1], floor);
      const ny = vy - drop(heights[index - WIDTH], heights[index + WIDTH], floor);
      const shaded = (nx * sx + ny * sy + vz * sz) / Math.hypot(nx, ny, vz);
      if (body.ocean && height < 0) {
        color = mix3(body.ocean.shallowColor, body.ocean.deepColor, -height / (depth * 0.5));
        // Molten seas light themselves.
        if (body.ocean.emissive > 0) color = mix3(color, [1, 0.45, 0.12], 0.6);
        const half = (vx * sx + vy * sy + vz * (sz + 1)) / Math.hypot(sx, sy, sz + 1);
        glint = half > 0 ? half ** 90 * 0.5 : 0;
      } else {
        const t = height / relief;
        color =
          t < 0.35
            ? mix3(palette.lowland, palette.midland, Math.max(0, t) / 0.35)
            : mix3(palette.midland, palette.highland, (t - 0.35) / 0.65);
        if (body.ocean) color = mix3(palette.sand, color, height / (relief * 0.04));
        // Frost: at the poles, lower in latitude the colder the world, and on the highest ground.
        const capEdge = body.temperatureK < 230 ? 0.55 : body.temperatureK < 290 ? 0.82 : 2;
        const frost = (Math.abs(dy) - capEdge) / 0.08 + Math.max(0, t - 0.9) * 3;
        if (body.atmosphere || body.kind === 'ice') color = mix3(color, palette.snow, frost);
      }

      let light = Math.min(1, Math.max(0, (facing + (air ? 0.1 : 0.0)) / (air ? 0.4 : 0.08)));
      light = 0.012 + light * light * (3 - 2 * light) * Math.max(0.12, shaded);

      if (body.clouds) {
        let sum = 0;
        let gain = 0.5;
        let scale = 2.4;
        for (let octave = 0; octave < 5; octave++) {
          sum += gain * cloudNoise.eval(dx * scale, dy * scale * 1.7, dz * scale);
          gain *= 0.5;
          scale *= 2.1;
        }
        const cover = Math.min(1, Math.max(0, (sum + (body.clouds.coverage - 0.5) * 0.9) * 2.6));
        const cloud = cover * cover * (3 - 2 * cover) * 0.9;
        color = mix3(color, body.clouds.color, cloud);
        glint *= 1 - cloud;
      }

      const rim = air ? (1 - vz) ** 2.6 * airStrength * Math.min(1, light * 4) : 0;
      const edge = Math.min(1, (1 - Math.sqrt(r2)) * DISC_RADIUS);
      const red = toScreen(
        shoulder(color[0] * light * EXPOSURE + glint * light + (air ? air[0] * rim * 0.55 : 0)),
      );
      const green = toScreen(
        shoulder(color[1] * light * EXPOSURE + glint * light + (air ? air[1] * rim * 0.55 : 0)),
      );
      const blue = toScreen(
        shoulder(color[2] * light * EXPOSURE + glint * light + (air ? air[2] * rim * 0.55 : 0)),
      );
      // One pixel of smoothing against the stars at the disc's edge.
      pixels[o] = red * edge + pixels[o] * (1 - edge);
      pixels[o + 1] = green * edge + pixels[o + 1] * (1 - edge);
      pixels[o + 2] = blue * edge + pixels[o + 2] * (1 - edge);
    }
  }
  context.putImageData(image, 0, 0);
}

/** A data URL picturing `params`, or null where it cannot be drawn (no canvas, unknown address). */
export function worldPortrait(id: string, params: WorldParams): string | null {
  const known = cache.get(id);
  if (known !== undefined) return known;
  let url: string | null = null;
  try {
    const body = findBody(params);
    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const context = canvas.getContext('2d');
    if (body && context) {
      draw(body, context);
      url = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
    }
  } catch {
    // A malformed address or a blocked canvas: the stock picture stands in.
    url = null;
  }
  cache.set(id, url);
  return url;
}
