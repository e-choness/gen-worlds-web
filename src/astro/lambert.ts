/**
 * Lambert's problem: the orbit that connects two positions in a given time of flight.
 * Single-revolution form of Izzo's algorithm (D. Izzo, "Revisiting Lambert's problem", Celestial
 * Mechanics and Dynamical Astronomy 121, 2015), written from the paper.
 */
import { cross, length, scale, sub, type Vec3 } from '@/astro/vec3';

export interface LambertSolution {
  /** Velocity at departure and at arrival, in the frame and units of the inputs. */
  v1: Vec3;
  v2: Vec3;
}

/** Gauss hypergeometric 2F1(3, 1; 5/2; x) by its series; used near the parabolic case. */
function hypergeometric(x: number): number {
  let result = 1;
  let term = 1;
  for (let i = 0; i < 200; i++) {
    term *= ((3 + i) * (1 + i) * x) / ((2.5 + i) * (i + 1));
    result += term;
    if (Math.abs(term) < 1e-14) break;
  }
  return result;
}

function computeY(x: number, lambda: number): number {
  return Math.sqrt(1 - lambda * lambda * (1 - x * x));
}

/** Non-dimensional time of flight for the free parameter x (x < 1 ellipse, x > 1 hyperbola). */
function timeOfFlight(x: number, y: number, lambda: number): number {
  if (x > Math.sqrt(0.6) && x < Math.sqrt(1.4)) {
    // Series form: the closed form below loses all precision around the parabola (x = 1).
    const eta = y - lambda * x;
    const s1 = (1 - lambda - x * eta) / 2;
    return (eta * eta * eta * (4 / 3) * hypergeometric(s1) + 4 * lambda * eta) / 2;
  }
  const oneMinusX2 = 1 - x * x;
  const psi =
    x < 1 ? Math.acos(x * y + lambda * oneMinusX2) : Math.asinh((y - x * lambda) * Math.sqrt(x * x - 1));
  return (psi / Math.sqrt(Math.abs(oneMinusX2)) - x + lambda * y) / oneMinusX2;
}

/** Householder iteration on x for the target non-dimensional time `target`. */
function solveX(target: number, lambda: number): number {
  const t0 = Math.acos(lambda) + lambda * Math.sqrt(1 - lambda * lambda);
  const t1 = (2 * (1 - lambda * lambda * lambda)) / 3;
  let x: number;
  if (target >= t0) x = (t0 / target) ** (2 / 3) - 1;
  else if (target < t1) x = ((5 / 2) * t1 * (t1 - target)) / (target * (1 - lambda ** 5)) + 1;
  else x = Math.exp((Math.LN2 * Math.log(target / t0)) / Math.log(t1 / t0)) - 1;

  for (let i = 0; i < 40; i++) {
    const y = computeY(x, lambda);
    const time = timeOfFlight(x, y, lambda);
    const f = time - target;
    const oneMinusX2 = 1 - x * x;
    const d1 = (3 * time * x - 2 + (2 * lambda ** 3 * x) / y) / oneMinusX2;
    const d2 = (3 * time + 5 * x * d1 + (2 * (1 - lambda * lambda) * lambda ** 3) / y ** 3) / oneMinusX2;
    const d3 = (7 * x * d2 + 8 * d1 - (6 * (1 - lambda * lambda) * lambda ** 5 * x) / y ** 5) / oneMinusX2;
    const step = (f * (d1 * d1 - (f * d2) / 2)) / (d1 * (d1 * d1 - f * d2) + (d3 * f * f) / 6);
    x -= step;
    if (Math.abs(step) < 1e-12) break;
  }
  return x;
}

/**
 * Solves Lambert's problem for less than one revolution.
 *
 * @param r1 departure position
 * @param r2 arrival position
 * @param tof time of flight, > 0
 * @param mu gravitational parameter of the central body, consistent with the other units
 * @param prograde true for motion counter-clockwise seen from +z (the direction planets move)
 * @returns null when the positions are collinear with the centre: the transfer plane is undefined.
 */
export function solveLambert(
  r1: Vec3,
  r2: Vec3,
  tof: number,
  mu: number,
  prograde = true,
): LambertSolution | null {
  const chord = length(sub(r2, r1));
  const r1Norm = length(r1);
  const r2Norm = length(r2);
  const semiPerimeter = (r1Norm + r2Norm + chord) / 2;
  const u1 = scale(r1, 1 / r1Norm);
  const u2 = scale(r2, 1 / r2Norm);
  const normal = cross(u1, u2);
  const normalLength = length(normal);
  if (tof <= 0 || chord === 0 || normalLength < 1e-10) return null;
  const h = scale(normal, 1 / normalLength);

  let lambda = Math.sqrt(1 - Math.min(1, chord / semiPerimeter));
  let t1: Vec3;
  let t2: Vec3;
  if (h[2] < 0) {
    // The short way round would be retrograde: take the long way (transfer angle > 180°).
    lambda = -lambda;
    t1 = cross(u1, h);
    t2 = cross(u2, h);
  } else {
    t1 = cross(h, u1);
    t2 = cross(h, u2);
  }
  if (!prograde) {
    lambda = -lambda;
    t1 = scale(t1, -1);
    t2 = scale(t2, -1);
  }

  const target = Math.sqrt((2 * mu) / semiPerimeter ** 3) * tof;
  const x = solveX(target, lambda);
  const y = computeY(x, lambda);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  const gamma = Math.sqrt((mu * semiPerimeter) / 2);
  const rho = (r1Norm - r2Norm) / chord;
  const sigma = Math.sqrt(1 - rho * rho);
  const radial1 = (gamma * (lambda * y - x - rho * (lambda * y + x))) / r1Norm;
  const radial2 = (-gamma * (lambda * y - x + rho * (lambda * y + x))) / r2Norm;
  const tangential1 = (gamma * sigma * (y + lambda * x)) / r1Norm;
  const tangential2 = (gamma * sigma * (y + lambda * x)) / r2Norm;
  return {
    v1: [
      radial1 * u1[0] + tangential1 * t1[0],
      radial1 * u1[1] + tangential1 * t1[1],
      radial1 * u1[2] + tangential1 * t1[2],
    ],
    v2: [
      radial2 * u2[0] + tangential2 * t2[0],
      radial2 * u2[1] + tangential2 * t2[1],
      radial2 * u2[2] + tangential2 * t2[2],
    ],
  };
}
