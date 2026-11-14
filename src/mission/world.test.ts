// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
import { describe, expect, it } from 'vitest';
import { getBody } from '@/data/bodies';
import { getScenario } from '@/data/scenarios';
import { decodeWorld, encodeWorld, type WorldParams } from '@/data/world';
import { planDescent } from '@/mission/descent-plan';
import { createReferenceDesign, type MissionDesign } from '@/mission/design';
import { budgetById, evaluateDesign } from '@/mission/evaluate-design';
import { simulateMission } from '@/mission/simulate-mission';

/** A small, cold, thin-aired desert world: close to Mars. */
const DUSTY: WorldParams = {
  name: 'Tavor IV',
  kind: 'desert',
  gravityMS2: 3.4,
  radiusKm: 3100,
  dayHours: 26,
  pressureBar: 0.02,
  temperatureK: 225,
  solarFlux: 0.5,
  axialTiltDeg: 20,
  address: { starSeed: 12345, starId: 's-1', positionLy: [10, 0, -4], bodyId: 's-1/3' },
};

function world(changes: Partial<WorldParams> = {}): string {
  return encodeWorld({ ...DUSTY, ...changes });
}

function baseline(id: string): MissionDesign {
  return createReferenceDesign(getScenario(id), 'engineer');
}

describe('missions on generated worlds', () => {
  it('rebuilds the same world from its id', () => {
    const id = world();

    const params = decodeWorld(id);

    expect(params.name).toBe('Tavor IV');
    expect(params.gravityMS2).toBeCloseTo(3.4);
    expect(params.address.bodyId).toBe('s-1/3');
    expect(encodeWorld(params)).toBe(id);
    expect(getBody(id).surfaceGravityMS2).toBeCloseTo(3.4);
  });

  it('refuses an id that does not describe a world', () => {
    expect(() => getScenario('world.not-a-world')).toThrow();
    expect(() => getScenario(`world.${btoa('[1,2,3]')}`)).toThrow();
  });

  it('names the mission after the world and explains what the world demands', () => {
    const scenario = getScenario(world());

    expect(scenario.name).toBe('Tavor IV surface survey');
    expect(scenario.briefing).toContain('35 %');
    expect(scenario.briefing).toContain('26 hours');
    expect(scenario.terms.destination).toBe('Tavor IV');
  });

  it('flies the Mars baseline on a Mars-like world and repeats the result', () => {
    const design = baseline(world());

    const evaluation = evaluateDesign(design);

    expect(evaluation.launchable).toBe(true);
    expect(simulateMission(design, 9)).toEqual(simulateMission(design, 9));
  });

  it('charges more propellant for a heavier world', () => {
    const light = evaluateDesign(baseline(world())).mass!;
    const heavy = evaluateDesign(baseline(world({ gravityMS2: 9, radiusKm: 6000 }))).mass!;

    expect(heavy.descentDeltaV).toBeGreaterThan(light.descentDeltaV * 1.4);
  });

  it('lands on engines alone where there is no air', () => {
    const airless = getScenario(world({ pressureBar: 0, kind: 'barren', gravityMS2: 1.6, radiusKm: 1700 }));

    expect(airless.entry).toBeNull();
    expect(airless.descent.deltaVMS).toBeGreaterThan(1700);
    expect(airless.transfers[0].orbitInsertionDeltaVMS).toBeGreaterThan(600);
    expect(airless.events).not.toContain('regional_dust_storm');
  });

  it('starves a solar rover far from its star', () => {
    const near = budgetById(evaluateDesign(baseline(world())), 'power');
    const far = budgetById(evaluateDesign(baseline(world({ solarFlux: 0.02 }))), 'power');

    expect(near.status).not.toBe('fail');
    expect(far.status).toBe('fail');
  });

  it('hands the landing to the pilot with local gravity and a morning Sun', () => {
    const plan = planDescent(evaluateDesign(baseline(world())))!;

    expect(plan.gravity).toBeCloseTo(3.4);
    expect(plan.sunElevation).toBeGreaterThan(0.2);
    expect(plan.siteName).toBe('Equatorial plains');
  });
});
