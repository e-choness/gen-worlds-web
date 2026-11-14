// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
/**
 * Volumetric cloud layer: a spherical slab between two radii, ray-marched per pixel.
 *
 * Density model after Schneider (Nubis): a large-scale weather field decides where clouds are, a
 * height profile rounds them, Worley noise erodes the edges. Lighting: a short march toward the star
 * with a multiple-scattering approximation (Wrenninge), dual-lobe phase, sky ambient.
 *
 * K = (base radius, top radius, coverage 0..1, time seconds)
 * camInfo = (|camPos|, r² - base², r² - top², per-pixel noise) — the differences come from float64.
 */
import { wgsl } from '@/engine/tsl';
import { atmRaySphere, atmSampleTransmittance } from './atmosphere-wgsl';

export const cloudDensity = wgsl<'float'>(/* wgsl */ `
fn cloudDensity(p: vec3<f32>, r: f32, tex: texture_3d<f32>, smp: sampler, K: vec4<f32>, cheap: bool) -> f32 {
  let hFrac = clamp((r - K.x) / (K.y - K.x), 0.0, 1.0);
  let drift = vec3<f32>(K.w * 14.0, 0.0, K.w * 6.0);
  let q = p + drift;
  // Weather: three decorrelated lookups at continental, regional and local scale hide the tiling.
  let w1 = textureSampleLevel(tex, smp, q / 3.1e6, 0.0).r;
  let w2 = textureSampleLevel(tex, smp, q.zxy / 7.3e5 + vec3<f32>(0.37, 0.11, 0.73), 0.0).r;
  let w3 = textureSampleLevel(tex, smp, q.yzx / 1.5e5 + vec3<f32>(0.61, 0.29, 0.07), 0.0).r;
  let weather = w1 * 0.5 + w2 * 0.32 + w3 * 0.18;
  let threshold = mix(0.74, 0.3, K.z);
  let base = clamp((weather - threshold) / 0.16, 0.0, 1.0);
  if (base <= 0.0) { return 0.0; }
  // Flat bases, domed tops; denser cells grow taller.
  let top = mix(0.35, 1.0, base);
  let profile = smoothstep(0.0, 0.1, hFrac) * (1.0 - smoothstep(top * 0.55, top, hFrac));
  var d = base * profile;
  if (cheap || d <= 0.0) { return d; }
  let e1 = textureSampleLevel(tex, smp, q / 2.1e4 + vec3<f32>(0.0, K.w * 0.0004, 0.0), 0.0).g;
  let e2 = textureSampleLevel(tex, smp, q / 5.3e3, 0.0).b;
  let erosion = (1.0 - e1) * 0.6 + (1.0 - e2) * 0.4;
  // Erode more near the edges (low d) and near the tops.
  d = clamp(d - erosion * mix(0.55, 0.22, d) * (0.6 + 0.4 * hFrac), 0.0, 1.0);
  return d;
}`);

/**
 * Composites the cloud layer over the scene colour.
 * Returns rgb = new colour, a = distance the atmosphere pass should treat as the surface
 * (the opacity-weighted cloud distance where clouds are dense, the original scene distance otherwise).
 */
export const cloudApply = wgsl<'vec4'>(
  /* wgsl */ `
fn cloudApply(
  sceneColor: vec3<f32>, rayDir: vec3<f32>, sceneDist: f32,
  camPos: vec3<f32>, camInfo: vec4<f32>, sunDir: vec3<f32>, sunColor: vec3<f32>, skyColor: vec3<f32>, tint: vec3<f32>,
  tLut: texture_2d<f32>, tSmp: sampler, noise: texture_3d<f32>, nSmp: sampler,
  K: vec4<f32>, Rg: f32, Rt: f32
) -> vec4<f32> {
  let r = camInfo.x;
  let b = dot(camPos, rayDir);
  let inner = atmRaySphere(b, camInfo.y);
  let outer = atmRaySphere(b, camInfo.z);
  var t0 = 0.0;
  var t1 = 0.0;
  if (camInfo.z > 0.0) {
    // Above the layer: enter through the top, leave through the base (or the far side of the top).
    if (outer.y <= 0.0) { return vec4<f32>(sceneColor, sceneDist); }
    t0 = max(outer.x, 0.0);
    t1 = outer.y;
    if (inner.x > 0.0) { t1 = inner.x; }
  } else if (camInfo.y > 0.0) {
    // Inside the layer.
    t0 = 0.0;
    t1 = outer.y;
    if (inner.x > 0.0) { t1 = inner.x; }
  } else {
    // Below the layer.
    t0 = inner.y;
    t1 = outer.y;
  }
  if (sceneDist > 0.0) { t1 = min(t1, sceneDist); }
  // Long grazing paths are capped: beyond that the layer is a thin sliver near the horizon.
  t1 = min(t1, t0 + 6.0e5);
  if (t1 <= t0) { return vec4<f32>(sceneColor, sceneDist); }

  let STEPS = 28;
  let dt = (t1 - t0) / f32(STEPS);
  let sigma = 0.011;
  let cosTheta = dot(rayDir, sunDir);
  // Dual-lobe Henyey-Greenstein (forward silver lining + mild back scatter), scaled so the mean is ~1.
  let g1 = 0.78;
  let g2 = -0.25;
  let hg1 = (1.0 - g1 * g1) / pow(1.0 + g1 * g1 - 2.0 * g1 * cosTheta, 1.5);
  let hg2 = (1.0 - g2 * g2) / pow(1.0 + g2 * g2 - 2.0 * g2 * cosTheta, 1.5);
  let phase = mix(hg2, hg1, 0.6);

  var T = 1.0;
  var L = vec3<f32>(0.0);
  var distAcc = 0.0;
  var weightAcc = 0.0;
  for (var i = 0; i < STEPS; i++) {
    if (T < 0.02) { break; }
    let t = t0 + (f32(i) + camInfo.w) * dt;
    let pos = camPos + rayDir * t;
    let rs = length(pos);
    let d = cloudDensity(pos, rs, noise, nSmp, K, false);
    if (d <= 0.001) { continue; }
    // Light march toward the star: four expanding steps.
    var tauL = 0.0;
    var stepL = 90.0;
    var travelled = 0.0;
    for (var j = 0; j < 4; j++) {
      let lp = pos + sunDir * (travelled + stepL * 0.5);
      tauL += cloudDensity(lp, length(lp), noise, nSmp, K, j > 1) * stepL;
      travelled += stepL;
      stepL *= 2.4;
    }
    let od = tauL * sigma;
    // Beer's law plus a slower-decaying lobe standing in for multiple scattering.
    let lightT = max(exp(-od), 0.55 * exp(-od * 0.22));
    let up = pos / rs;
    let muSun = dot(up, sunDir);
    let sunHere = sunColor * atmSampleTransmittance(tLut, tSmp, rs, muSun, Rg, Rt) * smoothstep(-0.05, 0.03, muSun);
    let hFrac = clamp((rs - K.x) / (K.y - K.x), 0.0, 1.0);
    let ambient = skyColor * (0.45 + 0.75 * hFrac);
    let radiance = (sunHere * lightT * (0.35 + 0.65 * phase) + ambient) * tint;
    let stepT = exp(-d * sigma * dt);
    let w = T * (1.0 - stepT);
    L += radiance * w;
    distAcc += t * w;
    weightAcc += w;
    T *= stepT;
  }
  let color = sceneColor * T + L;
  var dist = sceneDist;
  if (weightAcc > 0.5) { dist = distAcc / weightAcc; }
  return vec4<f32>(color, dist);
}`,
  [atmRaySphere, atmSampleTransmittance, cloudDensity],
);
