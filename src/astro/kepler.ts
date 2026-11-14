// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
/**
 * Two-body motion: Kepler's equation, classical elements → state vector, and universal-variable
 * propagation (valid for ellipses, parabolas and hyperbolas). Units are SI unless the caller keeps
 * `mu`, positions and times mutually consistent in another system.
 */
import { TAU } from '@/astro/constants';
import { addScaled, dot, length, scale, type Vec3 } from '@/astro/vec3';

export interface StateVector {
  /** Position relative to the central body. */
  r: Vec3;
  v: Vec3;
}

export interface OrbitalElements {
  /** Semi-major axis. */
  a: number;
  e: number;
  /** Radians, as are the three angles below. */
  inclination: number;
  longitudeOfNode: number;
  argumentOfPeriapsis: number;
  meanAnomaly: number;
}

/** Wraps an angle to (−π, π]. */
export function wrapPi(angle: number): number {
  const wrapped = angle - TAU * Math.floor((angle + Math.PI) / TAU);
  return wrapped === -Math.PI ? Math.PI : wrapped;
}

/** Solves `M = E − e·sin E` for the eccentric anomaly E (elliptic orbits, e < 1). */
export function solveKepler(meanAnomaly: number, e: number): number {
  const m = wrapPi(meanAnomaly);
  // Starting value that converges for every e < 1 (Danby).
  let eccentric = m + 0.85 * e * Math.sign(Math.sin(m) || 1);
  for (let i = 0; i < 30; i++) {
    const delta = (eccentric - e * Math.sin(eccentric) - m) / (1 - e * Math.cos(eccentric));
    eccentric -= delta;
    if (Math.abs(delta) < 1e-13) break;
  }
  return eccentric;
}

/** State vector of an elliptic orbit in the frame its angles are measured in. */
export function elementsToState(elements: OrbitalElements, mu: number): StateVector {
  const { a, e, inclination, longitudeOfNode, argumentOfPeriapsis, meanAnomaly } = elements;
  const eccentric = solveKepler(meanAnomaly, e);
  const cosE = Math.cos(eccentric);
  const sinE = Math.sin(eccentric);
  const root = Math.sqrt(1 - e * e);
  // Perifocal coordinates: x toward periapsis, y along the motion there.
  const x = a * (cosE - e);
  const y = a * root * sinE;
  const rate = Math.sqrt(mu * a) / (a * (1 - e * cosE));
  const vx = -rate * sinE;
  const vy = rate * root * cosE;

  const cosO = Math.cos(longitudeOfNode);
  const sinO = Math.sin(longitudeOfNode);
  const cosW = Math.cos(argumentOfPeriapsis);
  const sinW = Math.sin(argumentOfPeriapsis);
  const cosI = Math.cos(inclination);
  const sinI = Math.sin(inclination);
  const px: Vec3 = [cosO * cosW - sinO * sinW * cosI, sinO * cosW + cosO * sinW * cosI, sinW * sinI];
  const qx: Vec3 = [-cosO * sinW - sinO * cosW * cosI, -sinO * sinW + cosO * cosW * cosI, cosW * sinI];
  return { r: addScaled(scale(px, x), qx, y), v: addScaled(scale(px, vx), qx, vy) };
}

/** Stumpff functions c2 and c3. */
function stumpff(psi: number): [number, number] {
  if (psi > 1e-6) {
    const root = Math.sqrt(psi);
    return [(1 - Math.cos(root)) / psi, (root - Math.sin(root)) / (psi * root)];
  }
  if (psi < -1e-6) {
    const root = Math.sqrt(-psi);
    return [(1 - Math.cosh(root)) / psi, (Math.sinh(root) - root) / (-psi * root)];
  }
  return [1 / 2, 1 / 6];
}

/** Advances a state by `dt` along its conic (Vallado, algorithm 8). `dt` may be negative. */
export function propagate(state: StateVector, dt: number, mu: number): StateVector {
  if (dt === 0) return state;
  const { r, v } = state;
  const r0 = length(r);
  const rv = dot(r, v);
  const rootMu = Math.sqrt(mu);
  /** 1/a: positive for ellipses, negative for hyperbolas. */
  const alpha = 2 / r0 - dot(v, v) / mu;

  let chi: number;
  if (alpha > 1e-14 / r0) chi = rootMu * dt * alpha;
  else if (alpha < -1e-14 / r0) {
    const a = 1 / alpha;
    chi =
      Math.sign(dt) *
      Math.sqrt(-a) *
      Math.log((-2 * mu * alpha * dt) / (rv + Math.sign(dt) * Math.sqrt(-mu * a) * (1 - r0 * alpha)));
  } else chi = (rootMu * dt) / r0;

  let c2 = 0.5;
  let c3 = 1 / 6;
  let radius = r0;
  let psi = 0;
  for (let i = 0; i < 60; i++) {
    psi = chi * chi * alpha;
    [c2, c3] = stumpff(psi);
    radius = chi * chi * c2 + (rv / rootMu) * chi * (1 - psi * c3) + r0 * (1 - psi * c2);
    const delta =
      (rootMu * dt - chi * chi * chi * c3 - (rv / rootMu) * chi * chi * c2 - r0 * chi * (1 - psi * c3)) /
      radius;
    chi += delta;
    if (Math.abs(delta) < 1e-10 * Math.max(1, Math.abs(chi))) break;
  }
  // Recompute with the converged chi so f and g match the final radius.
  psi = chi * chi * alpha;
  [c2, c3] = stumpff(psi);
  radius = chi * chi * c2 + (rv / rootMu) * chi * (1 - psi * c3) + r0 * (1 - psi * c2);

  const f = 1 - (chi * chi * c2) / r0;
  const g = dt - (chi * chi * chi * c3) / rootMu;
  const gDot = 1 - (chi * chi * c2) / radius;
  const fDot = (rootMu / (radius * r0)) * chi * (psi * c3 - 1);
  return { r: addScaled(scale(r, f), v, g), v: addScaled(scale(r, fDot), v, gDot) };
}
