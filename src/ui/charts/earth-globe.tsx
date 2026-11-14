// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0 or MIT: see LICENSE.md.
/**
 * The Earth of the title screen: a globe that turns on its own and can be dragged round.
 *
 * Drawn pixel by pixel on a 2D canvas from the same Blue Marble map the 3D engine uses, so the
 * title screen needs no WebGPU. Sunlight, a sea glint, a drifting cloud layer and the blue limb are
 * computed per pixel; the clouds are noise, not data. Decorative: hidden from assistive technology.
 */
import { useEffect, useRef } from 'preact/hooks';
import { Noise3 } from '@/core/noise';
import { SURFACE_MAPS } from '@/data/surface-maps';
import { prefersReducedMotion } from '@/ui/dom';

/** Side of the drawing buffer, pixels. The cost per frame grows with its square. */
const BUFFER_PX = 560;
/** The disc's radius as a share of half the buffer; the rest holds the glow of the air. */
const DISC_SHARE = 0.9;
/** The map is reduced to this size before sampling: about one texel per pixel at the disc's centre. */
const MAP_WIDTH = 2048;
const MAP_HEIGHT = 1024;
const CLOUD_WIDTH = 768;
const CLOUD_HEIGHT = 384;
const CLOUD_SEED = 20261114;

/** One turn takes about two minutes when left alone. */
const SPIN_RAD_S = 0.05;
/** The clouds drift a little faster than the ground turns. */
const CLOUD_DRIFT_RAD_S = 0.012;
/** How fast a released drag dies away, per second. */
const DRAG_DAMPING = 2.2;
const DRAG_RAD_PER_PX = 0.006;
const MAX_PITCH = 1.2;
/** Starting view: Africa and Europe, seen from a little north of the equator. */
const START_YAW = -0.35;
const START_PITCH = 0.32;

/** Direction to the Sun in view space (x right, y up, z toward the viewer), unit length. */
const SUN = normalise(-0.62, 0.38, 0.69);
/** Halfway between the Sun and the viewer: where the sea glints. */
const HALF = normalise(SUN[0], SUN[1], SUN[2] + 1);

function normalise(x: number, y: number, z: number): [number, number, number] {
  const length = Math.hypot(x, y, z);
  return [x / length, y / length, z / length];
}

/** Cloud cover in 0..255 on an equirectangular grid, from 3D noise so it has no seam or pinch. */
function buildClouds(): Uint8Array {
  const noise = new Noise3(CLOUD_SEED);
  const out = new Uint8Array(CLOUD_WIDTH * CLOUD_HEIGHT);
  for (let j = 0; j < CLOUD_HEIGHT; j++) {
    const latitude = (0.5 - (j + 0.5) / CLOUD_HEIGHT) * Math.PI;
    const y = Math.sin(latitude);
    const ring = Math.cos(latitude);
    for (let i = 0; i < CLOUD_WIDTH; i++) {
      const longitude = ((i + 0.5) / CLOUD_WIDTH) * Math.PI * 2;
      const x = ring * Math.sin(longitude);
      const z = ring * Math.cos(longitude);
      let sum = 0;
      let gain = 0.5;
      let scale = 2.2;
      for (let octave = 0; octave < 5; octave++) {
        // Stretched east–west, as weather is.
        sum += gain * noise.eval(x * scale, y * scale * 1.7, z * scale);
        gain *= 0.5;
        scale *= 2.1;
      }
      const cover = Math.min(1, Math.max(0, (sum - 0.02) * 2.2));
      out[j * CLOUD_WIDTH + i] = Math.round(cover * cover * (3 - 2 * cover) * 255);
    }
  }
  return out;
}

/** Loads the colour map and reduces it to the sampling size; null when it cannot be read. */
async function loadMap(): Promise<Uint8ClampedArray | null> {
  const entry = SURFACE_MAPS.find((candidate) => candidate.body === 'earth');
  if (!entry) return null;
  const image = new Image();
  image.src = `${import.meta.env.BASE_URL}${entry.albedo}`;
  try {
    await image.decode();
  } catch {
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = MAP_WIDTH;
  canvas.height = MAP_HEIGHT;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(image, 0, 0, MAP_WIDTH, MAP_HEIGHT);
  return context.getImageData(0, 0, MAP_WIDTH, MAP_HEIGHT).data;
}

export function EarthGlobe({ class: className }: { class?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    canvas.width = BUFFER_PX;
    canvas.height = BUFFER_PX;
    const frame = context.createImageData(BUFFER_PX, BUFFER_PX);
    const pixels = frame.data;
    const centre = BUFFER_PX / 2;
    const radius = centre * DISC_SHARE;

    let map: Uint8ClampedArray | null = null;
    let clouds: Uint8Array | null = null;
    let yaw = START_YAW;
    let pitch = START_PITCH;
    let yawSpeed = 0;
    let cloudAngle = 0;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let lastTime = 0;
    let raf = 0;
    let disposed = false;
    const still = prefersReducedMotion();

    const draw = (): void => {
      if (!map || !clouds) return;
      const cosYaw = Math.cos(yaw);
      const sinYaw = Math.sin(yaw);
      const cosPitch = Math.cos(pitch);
      const sinPitch = Math.sin(pitch);
      const cloudShift = (cloudAngle / (Math.PI * 2)) * CLOUD_WIDTH;
      const outer = centre * centre;
      for (let py = 0; py < BUFFER_PX; py++) {
        const vy = (centre - py - 0.5) / radius;
        for (let px = 0; px < BUFFER_PX; px++) {
          const o = (py * BUFFER_PX + px) * 4;
          const vx = (px + 0.5 - centre) / radius;
          const r2 = vx * vx + vy * vy;
          if (r2 >= 1) {
            // The air seen edge-on beyond the limb: bright toward the Sun, gone by the buffer's edge.
            const dx = px + 0.5 - centre;
            const dy = centre - py - 0.5;
            const d2 = dx * dx + dy * dy;
            if (d2 >= outer) {
              pixels[o + 3] = 0;
              continue;
            }
            const r = Math.sqrt(r2);
            const fall = Math.exp(-(r - 1) * 26);
            const lit = Math.max(0, (vx * SUN[0] + vy * SUN[1]) / r + 0.35);
            pixels[o] = 90;
            pixels[o + 1] = 150;
            pixels[o + 2] = 255;
            pixels[o + 3] = Math.min(255, fall * lit * 190);
            continue;
          }
          const vz = Math.sqrt(1 - r2);
          // View normal into the planet's frame: undo the pitch about x, then the yaw about y.
          const ty = vy * cosPitch + vz * sinPitch;
          const tz = vz * cosPitch - vy * sinPitch;
          const bx = vx * cosYaw + tz * sinYaw;
          const bz = tz * cosYaw - vx * sinYaw;
          const u = Math.atan2(bx, bz) / (Math.PI * 2) + 0.5;
          const v = 0.5 - Math.asin(ty) / Math.PI;
          const mx = Math.min(MAP_WIDTH - 1, (u * MAP_WIDTH) | 0);
          const my = Math.min(MAP_HEIGHT - 1, (v * MAP_HEIGHT) | 0);
          const m = (my * MAP_WIDTH + mx) * 4;
          let red = map[m];
          let green = map[m + 1];
          let blue = map[m + 2];

          const facing = vx * SUN[0] + vy * SUN[1] + vz * SUN[2];
          // A soft terminator: the air scatters light a little way into the night.
          const day = Math.min(1, Math.max(0, (facing + 0.12) / 0.5));
          const light = 0.035 + 1.45 * day * day * (3 - 2 * day) * Math.max(0.25, facing);

          // Open water is dark and blue in the map; it alone glints.
          const water = blue > red * 1.25 && blue >= green;
          if (water) {
            // The map's deep water is nearly black; from space the sea is a clear dark blue.
            red = red * 0.6 + 8;
            green = green * 0.6 + 34;
            blue = blue * 0.6 + 78;
          }
          let glint = 0;
          if (water && facing > 0) {
            const h = vx * HALF[0] + vy * HALF[1] + vz * HALF[2];
            glint = h > 0 ? h ** 180 * 150 + h ** 24 * 26 : 0;
          }

          // Blended between the four nearest samples: the cloud grid is coarser than the screen.
          const cu = (((u * CLOUD_WIDTH + cloudShift - 0.5) % CLOUD_WIDTH) + CLOUD_WIDTH) % CLOUD_WIDTH;
          const cv = Math.min(CLOUD_HEIGHT - 1.001, Math.max(0, v * CLOUD_HEIGHT - 0.5));
          const cx = cu | 0;
          const cy = cv | 0;
          const cx1 = (cx + 1) % CLOUD_WIDTH;
          const fx = cu - cx;
          const fy = cv - cy;
          const row = cy * CLOUD_WIDTH;
          const below = row + CLOUD_WIDTH;
          const cloud =
            (((clouds[row + cx] * (1 - fx) + clouds[row + cx1] * fx) * (1 - fy) +
              (clouds[below + cx] * (1 - fx) + clouds[below + cx1] * fx) * fy) /
              255) *
            0.8;
          red += (240 - red) * cloud;
          green += (244 - green) * cloud;
          blue += (250 - blue) * cloud;
          glint *= 1 - cloud;

          // The limb: more air in the line of sight toward the edge, lit only by day.
          const rim = (1 - vz) ** 2.4 * day;
          red = red * light + glint + 70 * rim;
          green = green * light + glint + 130 * rim;
          blue = blue * light + glint + 235 * rim;

          pixels[o] = Math.min(red, 255);
          pixels[o + 1] = Math.min(green, 255);
          pixels[o + 2] = Math.min(blue, 255);
          // One pixel of smoothing at the disc's edge.
          const edge = (1 - Math.sqrt(r2)) * radius;
          pixels[o + 3] = edge >= 1 ? 255 : 255 * edge + 60 * (1 - edge);
        }
      }
      context.putImageData(frame, 0, 0);
    };

    const tick = (time: number): void => {
      raf = 0;
      if (disposed) return;
      const dt = lastTime ? Math.min(0.1, (time - lastTime) / 1000) : 0;
      lastTime = time;
      if (!dragging) {
        yaw += (yawSpeed + (still ? 0 : SPIN_RAD_S)) * dt;
        yawSpeed *= Math.exp(-DRAG_DAMPING * dt);
        if (Math.abs(yawSpeed) < 0.002) yawSpeed = 0;
      }
      if (!still) cloudAngle += CLOUD_DRIFT_RAD_S * dt;
      draw();
      // With reduced motion the globe only redraws while it is being moved.
      if (!still || dragging || yawSpeed !== 0) schedule();
      else lastTime = 0;
    };
    const schedule = (): void => {
      if (!raf && !disposed) raf = requestAnimationFrame(tick);
    };

    const onDown = (event: PointerEvent): void => {
      dragging = true;
      yawSpeed = 0;
      lastX = event.clientX;
      lastY = event.clientY;
      canvas.setPointerCapture(event.pointerId);
      schedule();
    };
    const onMove = (event: PointerEvent): void => {
      if (!dragging) return;
      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      lastX = event.clientX;
      lastY = event.clientY;
      // The surface follows the pointer: dragging right brings the western side into view.
      yaw -= dx * DRAG_RAD_PER_PX;
      pitch = Math.min(MAX_PITCH, Math.max(-MAX_PITCH, pitch + dy * DRAG_RAD_PER_PX));
      // Carried on after release, unless reduced motion asks for stillness.
      if (!still) yawSpeed = -dx * DRAG_RAD_PER_PX * 30;
    };
    const onUp = (): void => {
      dragging = false;
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);

    void loadMap().then((data) => {
      if (disposed || !data) return;
      map = data;
      clouds = buildClouds();
      if (canvas.parentElement) canvas.parentElement.dataset.ready = 'true';
      schedule();
    });

    return () => {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
    };
  }, []);

  // The wrapper carries the hiding: a canvas that takes the pointer cannot itself be aria-hidden.
  return (
    <div class={className} aria-hidden="true">
      <canvas ref={canvasRef} />
    </div>
  );
}
