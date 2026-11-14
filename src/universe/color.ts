// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
import type { Vec3Tuple } from './types';

export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Linear-sRGB colour from HSL (h in turns, s/l in 0..1). */
export function hsl(h: number, s: number, l: number): Vec3Tuple {
  h = ((h % 1) + 1) % 1;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    return srgbToLinear(l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
  };
  return [f(0), f(8), f(4)];
}

export function hex(value: number): Vec3Tuple {
  return [
    srgbToLinear(((value >> 16) & 255) / 255),
    srgbToLinear(((value >> 8) & 255) / 255),
    srgbToLinear((value & 255) / 255),
  ];
}

export function mixColor(a: Vec3Tuple, b: Vec3Tuple, t: number): Vec3Tuple {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function scaleColor(a: Vec3Tuple, s: number): Vec3Tuple {
  return [a[0] * s, a[1] * s, a[2] * s];
}

/**
 * Blackbody chromaticity as linear sRGB, normalised to max channel 1.
 * Fit after Tanner Helland's approximation of the CIE 1931 2° data (valid 1000 K – 40000 K).
 */
export function blackbody(kelvin: number): Vec3Tuple {
  const t = Math.min(40000, Math.max(1000, kelvin)) / 100;
  let r: number;
  let g: number;
  let b: number;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * (t - 60) ** -0.1332047592;
    g = 288.1221695283 * (t - 60) ** -0.0755148492;
    b = 255;
  }
  const lin: Vec3Tuple = [
    srgbToLinear(Math.min(255, Math.max(0, r)) / 255),
    srgbToLinear(Math.min(255, Math.max(0, g)) / 255),
    srgbToLinear(Math.min(255, Math.max(0, b)) / 255),
  ];
  const m = Math.max(lin[0], lin[1], lin[2]);
  return [lin[0] / m, lin[1] / m, lin[2] / m];
}
