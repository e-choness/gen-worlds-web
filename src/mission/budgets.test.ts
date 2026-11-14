import { describe, expect, it } from 'vitest';
import { jdFromDate } from '@/astro/time';
import { createEmptyDesign, type MissionDesign } from '@/mission/design';
import { budgetById, evaluateDesign } from '@/mission/evaluate-design';
import { previewChanges } from '@/mission/preview';

/** A VIPER-like rover at VIPER's site: the design every test starts from and then changes. */
function baseline(): MissionDesign {
  return {
    ...createEmptyDesign('lunar_ice_prospector', 'engineer'),
    slots: {
      bus: 'bus_standard',
      power: 'solar_vertical',
      battery: 'battery_medium',
      propulsion: 'prop_biprop',
      adcs: 'adcs_star_tracker',
      computer: 'obc_rad_hard',
      comms: 'comms_medium_gain',
      thermal: 'thermal_louvers',
      mobility: 'mobility_agile',
      landing: 'landing_trn',
    },
    instruments: [
      'inst_neutron_spectrometer',
      'inst_nir_spectrometer',
      'inst_mass_spectrometer',
      'inst_drill_1m',
      'inst_stereo_camera',
    ],
    trajectory: {
      launchVehicleId: 'falcon9',
      transferId: 'direct',
      siteId: 'mons_mouton',
      landingJd: jdFromDate(2027, 9, 1),
    },
  };
}

function withSlots(slots: MissionDesign['slots']): MissionDesign {
  const design = baseline();
  return { ...design, slots: { ...design.slots, ...slots } };
}

function withTrajectory(trajectory: Partial<MissionDesign['trajectory']>): MissionDesign {
  const design = baseline();
  return { ...design, trajectory: { ...design.trajectory, ...trajectory } };
}

describe('design evaluation', () => {
  it('accepts a VIPER-like baseline with no failed budget', () => {
    const evaluation = evaluateDesign(baseline());

    expect(evaluation.budgets.filter((line) => line.status === 'fail')).toEqual([]);
    expect(evaluation.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(evaluation.launchable).toBe(true);
    // Sanity anchors against the real rover: about 430 kg and 450 W.
    expect(evaluation.mass!.equipmentMassKg).toBeGreaterThan(350);
    expect(evaluation.mass!.equipmentMassKg).toBeLessThan(550);
    expect(evaluation.power!.solarLitW).toBeGreaterThan(350);
    expect(evaluation.power!.solarLitW).toBeLessThan(500);
  });

  it('gives every budget line an explanation', () => {
    for (const line of evaluateDesign(baseline()).budgets) {
      expect(line.why.length, line.id).toBeGreaterThan(30);
    }
  });

  it('reports an empty design as incomplete and names what is missing', () => {
    const evaluation = evaluateDesign(createEmptyDesign('lunar_ice_prospector', 'cadet'));

    expect(evaluation.launchable).toBe(false);
    expect(budgetById(evaluation, 'mass').status).toBe('incomplete');
    expect(evaluation.issues.map((issue) => issue.code)).toContain('missing_bus');
    expect(evaluation.issues.map((issue) => issue.code)).toContain('trajectory_incomplete');
  });

  it('needs far more propellant with a low-efficiency engine', () => {
    const biprop = evaluateDesign(baseline()).mass!;
    const monoprop = evaluateDesign(withSlots({ propulsion: 'prop_monoprop' })).mass!;

    expect(monoprop.propellantKg).toBeGreaterThan(biprop.propellantKg * 1.6);
  });

  it('fails the propellant line when cryogenic propellant takes the slow transfer', () => {
    const evaluation = evaluateDesign({
      ...withSlots({ propulsion: 'prop_methalox' }),
      trajectory: { ...baseline().trajectory, transferId: 'low_energy' },
    });

    const line = budgetById(evaluation, 'delta_v');
    expect(line.status).toBe('fail');
    expect(line.why).toContain('105');
    expect(evaluation.launchable).toBe(false);
  });

  it('fails the launch on a rocket that cannot leave Earth orbit', () => {
    const line = budgetById(evaluateDesign(withTrajectory({ launchVehicleId: 'electron' })), 'launch');

    expect(line.status).toBe('fail');
    expect(line.why).toContain('Electron');
  });

  it('fails the power line for sky-facing panels under a horizon Sun', () => {
    const line = budgetById(evaluateDesign(withSlots({ power: 'solar_body' })), 'power');

    expect(line.status).toBe('fail');
    expect(line.why).toContain('horizon');
  });

  it('fails a solar design on the floor of a permanently shadowed crater', () => {
    const evaluation = evaluateDesign(withTrajectory({ siteId: 'haworth_floor' }));

    expect(evaluation.visibility!.sunFraction).toBe(0);
    expect(budgetById(evaluation, 'thermal').status).toBe('fail');
    expect(budgetById(evaluation, 'data').status).toBe('fail');
  });

  it('lets a lean radioisotope design with a relay work in permanent shadow', () => {
    const design = withTrajectory({ siteId: 'haworth_floor', launchVehicleId: 'falcon9' });
    const evaluation = evaluateDesign({
      ...design,
      slots: {
        ...design.slots,
        power: 'rtg_mmrtg',
        comms: 'comms_relay',
        adcs: 'adcs_basic',
        mobility: 'mobility_basic',
        landing: 'landing_hazard_lidar',
      },
      instruments: ['inst_neutron_spectrometer', 'inst_mass_spectrometer', 'inst_drill_1m'],
    });

    expect(budgetById(evaluation, 'thermal').status).toBe('ok');
    expect(budgetById(evaluation, 'power').status).not.toBe('fail');
    expect(budgetById(evaluation, 'data').status).not.toBe('fail');
  });

  it('fails the data line when a narrow beam has no precise pointing', () => {
    const evaluation = evaluateDesign(withSlots({ comms: 'comms_high_gain', adcs: 'adcs_basic' }));

    const line = budgetById(evaluation, 'data');
    expect(line.status).toBe('fail');
    expect(line.why).toContain('pointing class 2');
  });

  it('warns that a low-gain radio cannot return what the instruments produce', () => {
    const line = budgetById(evaluateDesign(withSlots({ comms: 'comms_low_gain' })), 'data');

    expect(line.status).toBe('warning');
    expect(line.value).toBeGreaterThan(line.limit!);
  });

  it('fails the budget when everything is gold-plated', () => {
    const design = withTrajectory({ launchVehicleId: 'falcon_heavy' });
    const evaluation = evaluateDesign({
      ...design,
      slots: {
        ...design.slots,
        bus: 'bus_heavy',
        power: 'rtg_mmrtg',
        thermal: 'thermal_rhu',
        computer: 'obc_hpsc',
      },
      redundant: ['computer', 'comms', 'mobility'],
    });

    const line = budgetById(evaluation, 'cost');
    expect(line.status).toBe('fail');
    expect(line.margin).toBeLessThan(0);
  });

  it('gives the cadet tier a larger budget cap than the director tier', () => {
    const cadet = evaluateDesign({ ...baseline(), tier: 'cadet' }).cost;
    const director = evaluateDesign({ ...baseline(), tier: 'director' }).cost;

    expect(cadet.capMusd).toBeGreaterThan(director.capMusd);
    expect(cadet.totalMusd).toBe(director.totalMusd);
  });

  it('raises schedule risk for unproven parts and lowers loss risk with a better landing sensor', () => {
    const proven = evaluateDesign(baseline());
    const unproven = evaluateDesign(withSlots({ power: 'solar_mast', propulsion: 'prop_methalox' }));
    const blind = evaluateDesign(withSlots({ landing: 'landing_altimeter' }));

    expect(unproven.schedule.slipProbability).toBeGreaterThan(proven.schedule.slipProbability + 0.1);
    expect(blind.risk.missionLoss).toBeGreaterThan(proven.risk.missionLoss);
  });

  it('warns when the rover cannot climb down to the ice', () => {
    const evaluation = evaluateDesign({
      ...withSlots({ mobility: 'mobility_basic' }),
      trajectory: { ...baseline().trajectory, siteId: 'shackleton_ridge' },
    });

    expect(evaluation.issues.map((issue) => issue.code)).toContain('slope_too_steep');
  });

  it('previews a part change as budget shifts, with status changes first', () => {
    const current = evaluateDesign(baseline());
    const candidate = evaluateDesign(withSlots({ power: 'solar_body' }));

    const changes = previewChanges(current, candidate);

    expect(changes[0]).toMatchObject({ id: 'power', from: 'ok', to: 'fail', direction: -1 });
    expect(changes.find((change) => change.id === 'mass')!.delta).toBeCloseTo(-15, 6);
    expect(previewChanges(current, current)).toEqual([]);
  });

  it('gives the polar ridge more sunlight and less Earth contact than Mons Mouton', () => {
    const mouton = evaluateDesign(baseline()).visibility!;
    const ridge = evaluateDesign(withTrajectory({ siteId: 'shackleton_ridge' })).visibility!;

    expect(ridge.sunFraction).toBeGreaterThan(mouton.sunFraction);
    expect(ridge.earthFraction).toBeLessThan(mouton.earthFraction);
    expect(mouton.sunFraction).toBeGreaterThan(0.3);
    expect(mouton.earthFraction).toBeGreaterThan(0.4);
  });
});
