// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0 or MIT: see LICENSE.md.
import { describe, expect, it } from 'vitest';
import { getScenario } from '@/data/scenarios';
import { createReferenceDesign, type MissionDesign } from '@/mission/design';
import { budgetById, evaluateDesign } from '@/mission/evaluate-design';
import { simulateMission } from '@/mission/simulate-mission';

function baseline(): MissionDesign {
  return createReferenceDesign(getScenario('earth_observation'), 'engineer');
}

function inOrbit(orbitId: string): MissionDesign {
  const design = baseline();
  return { ...design, trajectory: { ...design.trajectory, orbitId } };
}

function withSlots(slots: MissionDesign['slots']): MissionDesign {
  const design = baseline();
  return { ...design, slots: { ...design.slots, ...slots } };
}

describe('Earth observation scenario', () => {
  it('launches the reference design, with the downlink as its weak point', () => {
    const evaluation = evaluateDesign(baseline());

    expect(evaluation.launchable).toBe(true);
    expect(budgetById(evaluation, 'data').status).toBe('warning');
  });

  it('spends about a third of each orbit in shadow and minutes a day over the station', () => {
    const orbit = evaluateDesign(baseline()).orbit!;

    expect(orbit.periodS / 60).toBeGreaterThan(90);
    expect(orbit.periodS / 60).toBeLessThan(100);
    expect(orbit.eclipseFraction).toBeGreaterThan(0.3);
    expect(orbit.eclipseFraction).toBeLessThan(0.4);
    expect(orbit.contactFraction).toBeGreaterThan(0.01);
    expect(orbit.contactFraction).toBeLessThan(0.08);
  });

  it('never enters shadow on the dawn-dusk orbit', () => {
    expect(evaluateDesign(inOrbit('sso_525_dawn_dusk')).orbit!.eclipseFraction).toBe(0);
  });

  it('falls out of a low orbit before the year is over', () => {
    const design = inOrbit('sso_420');

    const result = simulateMission(design, 3);

    expect(budgetById(evaluateDesign(design), 'delta_v').status).toBe('warning');
    expect(result.surface!.end.kind).toBe('reentered');
    expect(result.surface!.hoursOperated / 24).toBeLessThan(365);
  });

  it('refuses a high orbit that would leave the satellite up for decades', () => {
    const evaluation = evaluateDesign(inOrbit('sso_650'));

    expect(budgetById(evaluation, 'delta_v').status).toBe('fail');
    expect(evaluation.launchable).toBe(false);
  });

  it('accepts the high orbit once a thruster can bring the satellite down', () => {
    const design = withSlots({ propulsion: 'prop_green_mono' });
    const high: MissionDesign = {
      ...design,
      trajectory: { ...design.trajectory, orbitId: 'sso_650', launchVehicleId: 'electron' },
    };

    expect(budgetById(evaluateDesign(high), 'delta_v').status).toBe('ok');
  });

  it('cannot run on body-mounted cells alone', () => {
    expect(budgetById(evaluateDesign(withSlots({ power: 'solar_cells_body' })), 'power').status).toBe('fail');
  });

  it('delivers several times the ground with a radio that keeps up', () => {
    const slow = simulateMission(baseline(), 1);
    const fast = simulateMission(withSlots({ comms: 'comms_x_band_small' }), 1);

    expect(fast.metrics.area_imaged_mkm2).toBeGreaterThan(slow.metrics.area_imaged_mkm2 * 3);
  });

  it('returns the identical result for the same seed', () => {
    expect(simulateMission(baseline(), 5)).toEqual(simulateMission(baseline(), 5));
  });
});
