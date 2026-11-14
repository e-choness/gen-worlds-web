// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0 or MIT: see LICENSE.md.
import { describe, expect, it } from 'vitest';
import { AU, DAY, DEG, MU_SUN } from '@/astro/constants';
import { planetState, synodicPeriodDays } from '@/astro/ephemeris';
import { computePorkchop, planTransfer } from '@/astro/interplanetary';
import { elementsToState, propagate, type StateVector, solveKepler } from '@/astro/kepler';
import { solveLambert } from '@/astro/lambert';
import { siteSky, subEarthPoint, subSolarPoint } from '@/astro/lunar-geometry';
import { moonEcliptic } from '@/astro/moon';
import { captureDeltaV, departureDeltaV, hohmannTransfer, orbitalPeriod } from '@/astro/orbits';
import {
  type AtmosphereLayer,
  circularOrbitPeriod,
  contactFraction,
  dragLifetime,
  eclipseFraction,
  type OrbitedBody,
  sunSynchronousInclination,
} from '@/astro/planet-orbit';
import { deltaVFromMasses, propellantMass, propellantUsed } from '@/astro/rocket';
import { jdFromDate } from '@/astro/time';
import { distance, length } from '@/astro/vec3';

// Reference values, defined here so the tests do not depend on the catalogs.
const MU_EARTH = 3.986004418e14;
const EARTH: OrbitedBody = {
  mu: MU_EARTH,
  radius: 6378137,
  j2: 1.08263e-3,
  rotationPeriod: 86164.1,
  yearLength: 365.2422 * DAY,
};

describe('kepler', () => {
  it('solves the Kepler equation for a high eccentricity', () => {
    const e = 0.9;
    const m = 0.3;
    const eccentric = solveKepler(m, e);
    expect(eccentric - e * Math.sin(eccentric)).toBeCloseTo(m, 12);
  });

  it('returns to the start after one period', () => {
    const start = elementsToState(
      { a: 2 * AU, e: 0.4, inclination: 0.3, longitudeOfNode: 1, argumentOfPeriapsis: 2, meanAnomaly: 0.7 },
      MU_SUN,
    );
    const end = propagate(start, orbitalPeriod(MU_SUN, 2 * AU), MU_SUN);
    expect(distance(start.r, end.r) / AU).toBeLessThan(1e-8);
  });

  it('matches the element solution a quarter period later', () => {
    const elements = {
      a: 1.5 * AU,
      e: 0.2,
      inclination: 0.1,
      longitudeOfNode: 0.5,
      argumentOfPeriapsis: 1,
      meanAnomaly: 0,
    };
    const period = orbitalPeriod(MU_SUN, elements.a);
    const propagated = propagate(elementsToState(elements, MU_SUN), period / 4, MU_SUN);
    const direct = elementsToState({ ...elements, meanAnomaly: Math.PI / 2 }, MU_SUN);
    expect(distance(propagated.r, direct.r) / AU).toBeLessThan(1e-8);
    expect(distance(propagated.v, direct.v)).toBeLessThan(1e-3);
  });

  it('propagates a hyperbolic flyby and conserves energy', () => {
    const start: StateVector = { r: [7e6, 0, 0], v: [0, 12e3, 0] };
    const end = propagate(start, 3600, MU_EARTH);
    const energy = (s: StateVector) => length(s.v) ** 2 / 2 - MU_EARTH / length(s.r);
    expect(energy(end) / energy(start)).toBeCloseTo(1, 9);
    expect(length(end.r)).toBeGreaterThan(2e7);
  });
});

describe('ephemeris', () => {
  it('puts the Earth near perihelion distance at J2000', () => {
    expect(length(planetState('earth', 2451545.0).r) / AU).toBeCloseTo(0.9833, 3);
  });

  it('puts Mars 1.39 au from the Sun at J2000', () => {
    const mars = planetState('mars', 2451545.0).r;
    expect(length(mars) / AU).toBeCloseTo(1.391, 2);
    expect(mars[0] / AU).toBeCloseTo(1.39, 1);
  });

  it('gives the 26-month spacing of Mars launch windows', () => {
    expect(synodicPeriodDays('earth', 'mars')).toBeCloseTo(779.9, 0);
  });
});

describe('lambert', () => {
  it('reproduces the textbook Earth-orbit case (Vallado, example 7-5)', () => {
    const solution = solveLambert([15945.34e3, 0, 0], [12214.83899e3, 10249.46731e3, 0], 76 * 60, MU_EARTH);
    expect(solution).not.toBeNull();
    expect(solution!.v1[0] / 1e3).toBeCloseTo(2.058913, 4);
    expect(solution!.v1[1] / 1e3).toBeCloseTo(2.915965, 4);
    expect(solution!.v2[0] / 1e3).toBeCloseTo(-3.451565, 4);
    expect(solution!.v2[1] / 1e3).toBeCloseTo(0.910315, 4);
  });

  it('arrives at the target when the solution is propagated, including the long way round', () => {
    const r1 = planetState('earth', jdFromDate(2026, 11, 1)).r;
    for (const days of [150, 210, 300, 420]) {
      const r2 = planetState('mars', jdFromDate(2026, 11, 1) + days).r;
      const solution = solveLambert(r1, r2, days * DAY, MU_SUN);
      expect(solution).not.toBeNull();
      const arrival = propagate({ r: r1, v: solution!.v1 }, days * DAY, MU_SUN);
      expect(distance(arrival.r, r2) / AU).toBeLessThan(1e-6);
      expect(distance(arrival.v, solution!.v2)).toBeLessThan(0.01);
    }
  });

  it('returns null for an undefined transfer plane', () => {
    expect(solveLambert([AU, 0, 0], [-1.5 * AU, 0, 0], 200 * DAY, MU_SUN)).toBeNull();
  });
});

describe('interplanetary', () => {
  it('finds the late-2026 Mars window with a launch energy near 10 km²/s²', () => {
    const grid = computePorkchop({
      from: 'earth',
      to: 'mars',
      departureJdStart: jdFromDate(2026, 8, 1),
      departureJdEnd: jdFromDate(2027, 2, 1),
      columns: 47,
      arrivalJdStart: jdFromDate(2027, 5, 1),
      arrivalJdEnd: jdFromDate(2028, 2, 1),
      rows: 47,
    });
    expect(grid.best).not.toBeNull();
    const bestC3 = grid.c3[grid.best!.row * grid.columns + grid.best!.column];
    expect(bestC3).toBeGreaterThan(8);
    expect(bestC3).toBeLessThan(13);
    // The window is open in October–December 2026.
    const bestDeparture =
      grid.departureJdStart +
      ((grid.departureJdEnd - grid.departureJdStart) * grid.best!.column) / (grid.columns - 1);
    expect(bestDeparture).toBeGreaterThan(jdFromDate(2026, 10, 1));
    expect(bestDeparture).toBeLessThan(jdFromDate(2026, 12, 31));
  });

  it('charges far more launch energy outside the window', () => {
    const inWindow = planTransfer('earth', 'mars', jdFromDate(2026, 11, 10), jdFromDate(2027, 9, 1));
    const offWindow = planTransfer('earth', 'mars', jdFromDate(2027, 8, 1), jdFromDate(2028, 4, 1));
    expect(offWindow!.c3).toBeGreaterThan(inWindow!.c3 * 3);
  });
});

describe('rocket equation and transfers', () => {
  it('is consistent between propellant mass and delta-v', () => {
    const propellant = propellantMass(1000, 2500, 320);
    expect(deltaVFromMasses(1000 + propellant, 1000, 320)).toBeCloseTo(2500, 6);
    expect(propellantUsed(1000 + propellant, 2500, 320)).toBeCloseTo(propellant, 6);
  });

  it('gives the 3.9 km/s Hohmann transfer from low Earth orbit to geostationary orbit', () => {
    const transfer = hohmannTransfer(MU_EARTH, 6378e3 + 300e3, 42164e3);
    expect((transfer.deltaV1 + transfer.deltaV2) / 1e3).toBeCloseTo(3.89, 1);
    expect(transfer.timeOfFlight / 3600).toBeCloseTo(5.27, 1);
  });

  it('gives the 3.6 km/s trans-Mars injection from a 200 km parking orbit', () => {
    // C3 = 9 km²/s² → v∞ = 3 km/s.
    expect(departureDeltaV(MU_EARTH, 6578e3, 3000) / 1e3).toBeCloseTo(3.62, 1);
  });

  it('makes a loose capture orbit cheaper than a tight circular one', () => {
    const muMars = 4.282837e13;
    const circular = captureDeltaV(muMars, 2650, 3396e3 + 400e3);
    const elliptical = captureDeltaV(muMars, 2650, 3396e3 + 400e3, 3396e3 + 40000e3);
    expect(circular / 1e3).toBeCloseTo(2.07, 1);
    expect(elliptical).toBeLessThan(circular * 0.55);
  });
});

describe('orbit around a planet', () => {
  it('gives the 92-minute period of a 400 km Earth orbit', () => {
    expect(circularOrbitPeriod(EARTH, 400e3) / 60).toBeCloseTo(92.4, 0);
  });

  it('gives the 98.2° sun-synchronous inclination at 700 km', () => {
    expect(sunSynchronousInclination(EARTH, 700e3)! / DEG).toBeCloseTo(98.19, 1);
    expect(sunSynchronousInclination(EARTH, 8000e3)).toBeNull();
  });

  it('shades about a third of a low orbit and none of a terminator orbit', () => {
    expect(eclipseFraction(EARTH, 500e3)).toBeCloseTo(0.38, 1);
    expect(eclipseFraction(EARTH, 500e3, 80 * DEG)).toBe(0);
  });

  it('gives a polar station far more contact with a polar orbit than an equatorial station', () => {
    const polar = contactFraction(EARTH, 600e3, 97.8 * DEG, 78 * DEG, 5 * DEG);
    const equatorial = contactFraction(EARTH, 600e3, 97.8 * DEG, 0, 5 * DEG);
    expect(polar).toBeGreaterThan(equatorial * 2.5);
    expect(equatorial * 86400).toBeGreaterThan(600);
    expect(equatorial * 86400).toBeLessThan(3600);
    expect(contactFraction(EARTH, 600e3, 10 * DEG, 60 * DEG, 5 * DEG)).toBe(0);
  });

  it('keeps a higher orbit up for much longer', () => {
    const layers: AtmosphereLayer[] = [
      { baseAltitude: 150e3, baseDensity: 2.07e-9, scaleHeight: 22.5e3 },
      { baseAltitude: 300e3, baseDensity: 2.42e-11, scaleHeight: 53.6e3 },
      { baseAltitude: 500e3, baseDensity: 6.97e-13, scaleHeight: 63.8e3 },
    ];
    const year = 365.25 * DAY;
    const low = dragLifetime(EARTH, layers, 300e3, 50, 120e3, 200 * year);
    const high = dragLifetime(EARTH, layers, 550e3, 50, 120e3, 200 * year);
    expect(low).toBeGreaterThan(5 * DAY);
    expect(low).toBeLessThan(0.5 * year);
    expect(high).toBeGreaterThan(2 * year);
    expect(high).toBeLessThan(60 * year);
  });
});

describe('moon', () => {
  it('matches the worked example for 1992 April 12 (Meeus, example 47.a)', () => {
    const moon = moonEcliptic(2448724.5);
    const longitudeDeg = (((moon.longitude / DEG) % 360) + 360) % 360;
    expect(longitudeDeg).toBeCloseTo(133.16, 0);
    expect(moon.latitude / DEG).toBeCloseTo(-3.23, 0);
    expect(moon.distance / 1e3 / 368409.7).toBeCloseTo(1, 2);
  });

  it('keeps the Earth within a few degrees of the south-pole horizon and the Sun within 1.6°', () => {
    let earthMin = 90;
    let earthMax = -90;
    let sunMax = -90;
    const start = jdFromDate(2027, 1, 1);
    for (let day = 0; day < 365; day += 0.5) {
      const sky = siteSky(start + day, -89.5 * DEG, 0);
      earthMin = Math.min(earthMin, sky.earthElevation / DEG);
      earthMax = Math.max(earthMax, sky.earthElevation / DEG);
      sunMax = Math.max(sunMax, sky.sunElevation / DEG);
    }
    expect(earthMax).toBeGreaterThan(5);
    expect(earthMax).toBeLessThan(8);
    expect(earthMin).toBeLessThan(-5);
    expect(sunMax).toBeGreaterThan(1);
    expect(sunMax).toBeLessThan(2.2);
  });

  it('moves the sub-solar point westward once per synodic month', () => {
    const start = jdFromDate(2027, 3, 1);
    const drift = subSolarPoint(start + 1).longitude - subSolarPoint(start).longitude;
    const wrapped = Math.atan2(Math.sin(drift), Math.cos(drift)) / DEG;
    expect(wrapped).toBeCloseTo(-360 / 29.53, 0);
  });

  it('keeps the sub-Earth point within the libration limits', () => {
    const start = jdFromDate(2027, 1, 1);
    for (let day = 0; day < 60; day += 1.3) {
      const sub = subEarthPoint(start + day);
      expect(Math.abs(sub.latitude / DEG)).toBeLessThan(7);
      expect(Math.abs(sub.longitude / DEG)).toBeLessThan(8.5);
    }
  });
});
