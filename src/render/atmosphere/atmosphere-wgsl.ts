// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
/**
 * Physically based atmosphere after Hillaire 2020 ("A Scalable and Production Ready Sky and
 * Atmosphere Rendering Technique"), adapted to arbitrary planets viewed from ground to orbit.
 *
 *   transmittance LUT   (mu, r)        optical depth to the top of the atmosphere
 *   multi-scatter LUT   (mu_sun, r)    isotropic infinite-order scattering transfer
 *   apply pass          per pixel      single scattering ray-march between camera and scene depth
 *                                      (or atmosphere exit), composited over the scene colour
 *
 * All atmosphere parameters travel in one mat4 `P` and one vec4 `Q` so helper signatures stay short:
 *   P[0] = rayleigh scattering rgb, rayleigh scale height
 *   P[1] = mie scattering rgb,      mie scale height
 *   P[2] = mie extinction rgb,      mie anisotropy g
 *   P[3] = absorption rgb,          ground radius Rg
 *   Q    = (top radius Rt, absorption layer centre height, absorption layer half width, ground albedo)
 * Distances are metres. Each WGSL string holds exactly one function (three's wgslFn contract);
 * dependencies are wired through `includes`.
 */
import { wgsl } from '@/engine/tsl';

export const atmDensity = wgsl<'vec3'>(/* wgsl */ `
fn atmDensity(h: f32, P: mat4x4<f32>, Q: vec4<f32>) -> vec3<f32> {
  let hh = max(h, 0.0);
  return vec3<f32>(exp(-hh / P[0].w), exp(-hh / P[1].w), max(0.0, 1.0 - abs(hh - Q.y) / Q.z));
}`);

export const atmExtinction = wgsl<'vec3'>(/* wgsl */ `
fn atmExtinction(d: vec3<f32>, P: mat4x4<f32>) -> vec3<f32> {
  return P[0].xyz * d.x + P[2].xyz * d.y + P[3].xyz * d.z;
}`);

/** Distance to the nearest positive intersection with a sphere given b = dot(o, d), c = |o|² - R². -1 if none. */
export const atmRaySphere = wgsl<'vec2'>(/* wgsl */ `
fn atmRaySphere(b: f32, c: f32) -> vec2<f32> {
  let disc = b * b - c;
  if (disc < 0.0) { return vec2<f32>(-1.0, -1.0); }
  let s = sqrt(disc);
  // Numerically stable roots: avoid subtracting nearly equal numbers.
  var t0: f32;
  var t1: f32;
  if (b > 0.0) { t0 = -b - s; t1 = c / t0; } else { t1 = -b + s; t0 = c / t1; }
  if (t1 == 0.0) { t0 = -b - s; }
  return vec2<f32>(min(t0, t1), max(t0, t1));
}`);

export const atmTransmittanceUv = wgsl<'vec2'>(/* wgsl */ `
fn atmTransmittanceUv(r: f32, mu: f32, Rg: f32, Rt: f32) -> vec2<f32> {
  let H = sqrt(Rt * Rt - Rg * Rg);
  let rho = sqrt(max(0.0, (r - Rg) * (r + Rg)));
  let disc = r * r * (mu * mu - 1.0) + Rt * Rt;
  let d = max(0.0, -r * mu + sqrt(max(disc, 0.0)));
  let dMin = Rt - r;
  let dMax = rho + H;
  return vec2<f32>(clamp((d - dMin) / max(dMax - dMin, 1e-3), 0.0, 1.0), clamp(rho / H, 0.0, 1.0));
}`);

/** LUT generator: uv -> transmittance from (r, mu) to the top of the atmosphere. */
export const atmTransmittanceLut = wgsl<'vec4'>(
  /* wgsl */ `
fn atmTransmittanceLut(uv: vec2<f32>, P: mat4x4<f32>, Q: vec4<f32>) -> vec4<f32> {
  let Rg = P[3].w;
  let Rt = Q.x;
  let H = sqrt(Rt * Rt - Rg * Rg);
  let rho = H * uv.y;
  let r = sqrt(rho * rho + Rg * Rg);
  let dMin = Rt - r;
  let dMax = rho + H;
  let d = dMin + uv.x * (dMax - dMin);
  var mu = 1.0;
  if (d > 0.0) { mu = clamp((H * H - rho * rho - d * d) / (2.0 * r * d), -1.0, 1.0); }
  // Integrate optical depth along the ray to the top boundary.
  let steps = 40;
  let dt = d / f32(steps);
  var tau = vec3<f32>(0.0);
  for (var i = 0; i < steps; i++) {
    let t = (f32(i) + 0.5) * dt;
    let rs = sqrt(r * r + 2.0 * r * mu * t + t * t);
    tau += atmExtinction(atmDensity(rs - Rg, P, Q), P) * dt;
  }
  return vec4<f32>(exp(-tau), 1.0);
}`,
  [atmDensity, atmExtinction],
);

export const atmSampleTransmittance = wgsl<'vec3'>(
  /* wgsl */ `
fn atmSampleTransmittance(tex: texture_2d<f32>, smp: sampler, r: f32, mu: f32, Rg: f32, Rt: f32) -> vec3<f32> {
  let uv = atmTransmittanceUv(clamp(r, Rg, Rt), mu, Rg, Rt);
  return textureSampleLevel(tex, smp, uv, 0.0).rgb;
}`,
  [atmTransmittanceUv],
);

/** LUT generator: uv = (mu_sun * 0.5 + 0.5, height fraction) -> multiple scattering contribution per unit illuminance. */
export const atmMultiScatterLut = wgsl<'vec4'>(
  /* wgsl */ `
fn atmMultiScatterLut(uv: vec2<f32>, tex: texture_2d<f32>, smp: sampler, P: mat4x4<f32>, Q: vec4<f32>) -> vec4<f32> {
  let Rg = P[3].w;
  let Rt = Q.x;
  let muS = uv.x * 2.0 - 1.0;
  let r = Rg + clamp(uv.y, 0.0, 1.0) * (Rt - Rg) + 1.0;
  let sunDir = vec3<f32>(sqrt(max(0.0, 1.0 - muS * muS)), muS, 0.0);
  let origin = vec3<f32>(0.0, r, 0.0);
  let SQRT_SAMPLES = 8;
  let STEPS = 20;
  var lumTotal = vec3<f32>(0.0);
  var fms = vec3<f32>(0.0);
  for (var i = 0; i < SQRT_SAMPLES; i++) {
    for (var j = 0; j < SQRT_SAMPLES; j++) {
      let u = (f32(i) + 0.5) / f32(SQRT_SAMPLES);
      let v = (f32(j) + 0.5) / f32(SQRT_SAMPLES);
      let theta = 6.28318530718 * u;
      let cosPhi = 1.0 - 2.0 * v;
      let sinPhi = sqrt(max(0.0, 1.0 - cosPhi * cosPhi));
      let dir = vec3<f32>(sinPhi * cos(theta), cosPhi, sinPhi * sin(theta));
      let b = dot(origin, dir);
      let top = atmRaySphere(b, r * r - Rt * Rt);
      let ground = atmRaySphere(b, r * r - Rg * Rg);
      var tMax = top.y;
      let hitGround = ground.x > 0.0;
      if (hitGround) { tMax = ground.x; }
      let dt = tMax / f32(STEPS);
      var T = vec3<f32>(1.0);
      var L = vec3<f32>(0.0);
      var F = vec3<f32>(0.0);
      for (var s = 0; s < STEPS; s++) {
        let t = (f32(s) + 0.5) * dt;
        let pos = origin + dir * t;
        let rs = length(pos);
        let dens = atmDensity(rs - Rg, P, Q);
        let ext = atmExtinction(dens, P);
        let scat = P[0].xyz * dens.x + P[1].xyz * dens.y;
        let stepT = exp(-ext * dt);
        let up = pos / rs;
        let muSun = dot(up, sunDir);
        var Tsun = atmSampleTransmittance(tex, smp, rs, muSun, Rg, Rt);
        // Planet shadow.
        let sg = atmRaySphere(rs * muSun, rs * rs - Rg * Rg);
        if (sg.x > 0.0) { Tsun = vec3<f32>(0.0); }
        // Isotropic phase for the transfer integral.
        let S = scat * Tsun * 0.0795774715;
        let extSafe = max(ext, vec3<f32>(1e-12));
        L += T * (S - S * stepT) / extSafe;
        F += T * (scat - scat * stepT) / extSafe;
        T *= stepT;
      }
      if (hitGround) {
        let pos = origin + dir * tMax;
        let up = normalize(pos);
        let muSun = dot(up, sunDir);
        if (muSun > 0.0) {
          let Tsun = atmSampleTransmittance(tex, smp, Rg, muSun, Rg, Rt);
          L += T * Tsun * muSun * Q.w * 0.318309886;
        }
      }
      lumTotal += L;
      fms += F;
    }
  }
  let inv = 1.0 / f32(SQRT_SAMPLES * SQRT_SAMPLES);
  let psi = (lumTotal * inv) / (vec3<f32>(1.0) - min(fms * inv, vec3<f32>(0.96)));
  return vec4<f32>(psi, 1.0);
}`,
  [atmDensity, atmExtinction, atmRaySphere, atmSampleTransmittance],
);

/**
 * Per-pixel atmosphere: marches from the camera (or atmosphere entry) to the scene surface (or
 * atmosphere exit), returns scene * transmittance + in-scattered light.
 *
 *   camPos   camera relative to the planet centre
 *   camInfo  (r = |camPos|, r² - Rg², r² - Rt², interleaved noise 0..1)   — the two differences are computed in
 *            float64 on the CPU; in float32 they would cancel catastrophically near the ground
 *   sun      xyz direction to the star, w illuminance scale
 *   sceneDist distance to the opaque surface along the ray, <0 for sky
 */
export const atmApply = wgsl<'vec3'>(
  /* wgsl */ `
fn atmApply(
  sceneColor: vec3<f32>, rayDir: vec3<f32>, sceneDist: f32,
  camPos: vec3<f32>, camInfo: vec4<f32>, sun: vec4<f32>, sunColor: vec3<f32>,
  tLut: texture_2d<f32>, tSmp: sampler, msLut: texture_2d<f32>, msSmp: sampler,
  P: mat4x4<f32>, Q: vec4<f32>
) -> vec3<f32> {
  let Rg = P[3].w;
  let Rt = Q.x;
  let r = camInfo.x;
  let b = dot(camPos, rayDir);
  let top = atmRaySphere(b, camInfo.z);
  if (top.y <= 0.0) { return sceneColor; }
  var tStart = max(top.x, 0.0);
  var tEnd = top.y;
  let ground = atmRaySphere(b, camInfo.y);
  if (ground.x > 0.0) { tEnd = min(tEnd, ground.x); }
  if (sceneDist > 0.0) { tEnd = min(tEnd, sceneDist); }
  if (tEnd <= tStart) { return sceneColor; }

  let sunDir = sun.xyz;
  let cosTheta = dot(rayDir, sunDir);
  let g = P[2].w;
  let phaseR = 0.0596831037 * (1.0 + cosTheta * cosTheta);
  // Cornette-Shanks Mie phase.
  let gg = g * g;
  let phaseM = 0.119366207 * ((1.0 - gg) * (1.0 + cosTheta * cosTheta)) / ((2.0 + gg) * pow(max(1.0 + gg - 2.0 * g * cosTheta, 1e-4), 1.5));

  let STEPS = 28;
  let len = tEnd - tStart;
  var T = vec3<f32>(1.0);
  var L = vec3<f32>(0.0);
  var tPrev = 0.0;
  for (var i = 0; i < STEPS; i++) {
    // Quadratic sample distribution: dense near the camera where density changes fastest on screen.
    let f1 = (f32(i) + 1.0) / f32(STEPS);
    let tNext = f1 * f1 * len;
    let dt = tNext - tPrev;
    let t = tStart + tPrev + dt * camInfo.w;
    tPrev = tNext;
    let pos = camPos + rayDir * t;
    let rs = max(length(pos), Rg + 1.0);
    let dens = atmDensity(rs - Rg, P, Q);
    let ext = atmExtinction(dens, P);
    let scatR = P[0].xyz * dens.x;
    let scatM = P[1].xyz * dens.y;
    let up = pos / rs;
    let muSun = dot(up, sunDir);
    var Tsun = atmSampleTransmittance(tLut, tSmp, rs, muSun, Rg, Rt);
    // Soft planet shadow (terminator): fade over a small angular range to hide stepping.
    let horizonMu = -sqrt(max(0.0, 1.0 - (Rg * Rg) / (rs * rs)));
    Tsun *= smoothstep(horizonMu - 0.012, horizonMu + 0.012, muSun);
    let msUv = vec2<f32>(muSun * 0.5 + 0.5, clamp((rs - Rg) / (Rt - Rg), 0.0, 1.0));
    let psi = textureSampleLevel(msLut, msSmp, msUv, 0.0).rgb;
    let S = (scatR * phaseR + scatM * phaseM) * Tsun + (scatR + scatM) * psi;
    let stepT = exp(-ext * dt);
    L += T * (S - S * stepT) / max(ext, vec3<f32>(1e-12));
    T *= stepT;
  }
  return sceneColor * T + L * sunColor * sun.w;
}`,
  [atmDensity, atmExtinction, atmRaySphere, atmSampleTransmittance],
);

/** Sun colour reaching a surface point at radius r with cosine sun-zenith mu (includes the terminator fade). */
export const atmSunAtSurface = wgsl<'vec3'>(
  /* wgsl */ `
fn atmSunAtSurface(tex: texture_2d<f32>, smp: sampler, r: f32, mu: f32, Rg: f32, Rt: f32) -> vec3<f32> {
  let T = atmSampleTransmittance(tex, smp, r, mu, Rg, Rt);
  return T * smoothstep(-0.02, 0.01, mu);
}`,
  [atmSampleTransmittance],
);
