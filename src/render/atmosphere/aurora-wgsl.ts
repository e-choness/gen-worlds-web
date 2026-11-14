// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
/**
 * Aurora: emission from a thin shell high above the atmosphere, concentrated in an oval around
 * each pole of the spin axis and only on the night side. Curtains come from noise that is stretched
 * along altitude and varies quickly around the axis; oxygen green low in the shell grades to red
 * and violet at the top.
 *
 * A = (shell bottom radius, shell top radius, strength, time)
 */
import { wgsl } from '@/engine/tsl';
import { gxNoise } from '@/engine/wgsl-noise';
import { atmRaySphere } from './atmosphere-wgsl';

export const auroraGlow = wgsl<'vec3'>(
  /* wgsl */ `
fn auroraGlow(rayDir: vec3<f32>, camPos: vec3<f32>, sceneDist: f32, jitter: f32, axis: vec3<f32>, sunDir: vec3<f32>, A: vec4<f32>) -> vec3<f32> {
  let r2 = dot(camPos, camPos);
  let b = dot(camPos, rayDir);
  let lo = atmRaySphere(b, r2 - A.x * A.x);
  let hi = atmRaySphere(b, r2 - A.y * A.y);
  if (hi.y <= 0.0) { return vec3<f32>(0.0); }
  var t0 = max(hi.x, 0.0);
  var t1 = hi.y;
  if (r2 < A.x * A.x) {
    t0 = lo.y;
  } else if (lo.x > 0.0) {
    t1 = lo.x;
  }
  if (sceneDist > 0.0) { t1 = min(t1, sceneDist); }
  t1 = min(t1, t0 + (A.y - A.x) * 30.0);
  if (t1 <= t0) { return vec3<f32>(0.0); }

  let e1 = normalize(cross(axis, vec3<f32>(0.31, 0.12, 0.94)));
  let e2 = cross(axis, e1);
  let STEPS = 20;
  let dt = (t1 - t0) / f32(STEPS);
  var glow = vec3<f32>(0.0);
  for (var i = 0; i < STEPS; i++) {
    let p = camPos + rayDir * (t0 + (f32(i) + jitter) * dt);
    let rp = length(p);
    let up = p / rp;
    let night = smoothstep(0.12, -0.2, dot(up, sunDir));
    if (night <= 0.0) { continue; }
    let sinLat = abs(dot(up, axis));
    // Auroral oval at ~67 degrees of latitude, wandering slowly.
    let phi = atan2(dot(up, e1), dot(up, e2));
    let wander = (gxNoise(vec3<f32>(phi * 2.0, A.w * 0.01, 3.7)) - 0.5) * 0.05;
    let oval = exp(-pow((sinLat - 0.92 - wander) / 0.022, 2.0));
    if (oval < 0.01) { continue; }
    let h = clamp((rp - A.x) / (A.y - A.x), 0.0, 1.0);
    // Curtains: fine structure around the axis, slow drift, rays fading upward.
    let fold = gxNoise(vec3<f32>(phi * 55.0 + A.w * 0.03, sinLat * 240.0, A.w * 0.02));
    let rays = gxNoise(vec3<f32>(phi * 420.0, sinLat * 900.0, A.w * 0.11));
    let curtain = pow(fold, 3.0) * (0.45 + 0.9 * rays);
    let profile = smoothstep(0.0, 0.08, h) * exp(-h * 3.2);
    let tint = mix(vec3<f32>(0.1, 1.0, 0.35), vec3<f32>(0.75, 0.12, 0.6), smoothstep(0.15, 0.85, h));
    glow += tint * (curtain * profile * oval * night) * dt;
  }
  return glow * A.z / (A.y - A.x);
}`,
  [atmRaySphere, gxNoise],
);
