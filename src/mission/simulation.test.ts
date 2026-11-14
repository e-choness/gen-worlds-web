// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
import { describe, expect, it } from 'vitest';
import { jdFromDate } from '@/astro/time';
import { landingInputFromDescent, planDescent } from '@/mission/descent-plan';
import { createEmptyDesign, type MissionDesign } from '@/mission/design';
import { evaluateDesign } from '@/mission/evaluate-design';
import { rollEvents } from '@/mission/event-roll';
import { SCRIPTED_INPUT_LOG } from '@/mission/input-log';
import { runMonteCarlo } from '@/mission/monte-carlo';
import { PHASE_TRANSITIONS, simulateMission } from '@/mission/simulate-mission';

/** A VIPER-like rover landing at Mons Mouton in polar summer. */
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

describe('mission simulation', () => {
  it('returns the identical result for the same design, seed and input log', () => {
    const first = simulateMission(baseline(), 1234);
    const second = simulateMission(baseline(), 1234);

    expect(second).toEqual(first);
  });

  it('gives different missions for different seeds', () => {
    const scores = new Set(
      [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => simulateMission(baseline(), seed).score.total),
    );

    expect(scores.size).toBeGreaterThan(3);
  });

  it('refuses a design that cannot launch', () => {
    expect(() => simulateMission(createEmptyDesign('lunar_ice_prospector', 'engineer'), 1)).toThrow();
  });

  it('only lists phase transitions between known phases, and none out of an end state', () => {
    const phases = Object.keys(PHASE_TRANSITIONS);

    for (const targets of Object.values(PHASE_TRANSITIONS)) {
      for (const target of targets) expect(phases).toContain(target);
    }
    expect(PHASE_TRANSITIONS.complete).toEqual([]);
    expect(PHASE_TRANSITIONS.lost).toEqual([]);
  });

  it('lets the baseline succeed most of the time with a sensible spread of scores', () => {
    const summary = runMonteCarlo(baseline(), 120, 7);

    expect(summary.successShare + summary.partialShare).toBeGreaterThan(0.6);
    expect(summary.lostShare).toBeLessThan(0.25);
    expect(summary.scoreP90).toBeGreaterThan(summary.scoreP10);
    expect(summary.scoreP50).toBeGreaterThan(400);
    expect(summary.scoreP50).toBeLessThan(1500);
  });

  it('scores a winter landing far below a summer landing', () => {
    const winter = {
      ...baseline(),
      trajectory: { ...baseline().trajectory, landingJd: jdFromDate(2028, 1, 20) },
    };

    const summerScore = runMonteCarlo(baseline(), 60, 11).scoreMean;
    const winterSummary = runMonteCarlo(winter, 60, 11);

    expect(winterSummary.scoreMean).toBeLessThan(summerScore * 0.6);
    expect(winterSummary.survivedShare).toBeLessThan(0.2);
  });

  it('explains a frozen vehicle by its battery and the night', () => {
    const winter = {
      ...baseline(),
      trajectory: { ...baseline().trajectory, landingJd: jdFromDate(2028, 1, 20) },
    };
    let frozen = null;
    for (let seed = 0; seed < 40 && !frozen; seed++) {
      const result = simulateMission(winter, seed);
      if (result.surface?.end.kind === 'froze') frozen = result;
    }

    expect(frozen).not.toBeNull();
    const finding = frozen!.findings[0];
    expect(finding.tone).toBe('bad');
    expect(finding.slot).toBe('thermal');
    expect(finding.detail).toContain('battery');
  });

  it('returns less data through a low-gain radio than through a medium-gain antenna', () => {
    const low = runMonteCarlo(withSlots({ comms: 'comms_low_gain' }), 40, 3);
    const medium = runMonteCarlo(baseline(), 40, 3);

    expect(low.scoreMean).toBeLessThan(medium.scoreMean);
  });

  it('never confirms ice without a drill and says why', () => {
    const noDrill = {
      ...baseline(),
      instruments: ['inst_neutron_spectrometer', 'inst_nir_spectrometer', 'inst_stereo_camera'],
    };
    let landed = null;
    for (let seed = 0; seed < 20 && !landed; seed++) {
      const result = simulateMission(noDrill, seed);
      if (result.surface) landed = result;
    }

    const ice = landed!.objectives.find((result) => result.objective.metric === 'ice_samples');
    expect(ice!.achieved).toBe(0);
    expect(ice!.why).toContain('drilling');
  });

  it('strikes the same events at the same times whatever the design', () => {
    const roll = (design: MissionDesign) => {
      const evaluation = evaluateDesign(design);
      return rollEvents({
        resolved: evaluation.resolved,
        seed: 99,
        costMargin: evaluation.cost.margin,
        slipProbability: 0,
        cruiseDays: 4.5,
        surfaceDays: 100,
      });
    };
    const soft = roll(withSlots({ computer: 'obc_commercial' })).filter(
      (occurrence) => occurrence.event.id === 'solar_particle_event',
    );
    const hard = roll(baseline()).filter((occurrence) => occurrence.event.id === 'solar_particle_event');

    expect(hard.map((occurrence) => occurrence.hour)).toEqual(soft.map((occurrence) => occurrence.hour));
    for (const occurrence of hard) expect(occurrence.magnitude).toBe(0);
    for (const occurrence of soft) expect(occurrence.magnitude).toBeGreaterThan(0);
  });

  it('crashes a hand-flown landing that burns more than the tanks hold', () => {
    const result = simulateMission(baseline(), 5, {
      ...SCRIPTED_INPUT_LOG,
      landing: { descentDeltaVFactor: 1.5, accuracyM: 20, crashSpeedMS: null },
    });

    expect(result.lostIn).toBe('landing');
    expect(result.score.total).toBe(0);
    expect(result.timeline.at(-1)!.title).toBe('Out of propellant');
  });

  it('turns a hand-flown descent into a landing input the simulation accepts or rejects', () => {
    const evaluation = evaluateDesign(baseline());
    const plan = planDescent(evaluation)!;

    const good = landingInputFromDescent(plan, evaluation, {
      result: 'landed',
      deltaVUsed: plan.nominalDeltaV,
      accuracyM: 40,
      touchdownSpeedMS: 1.2,
    });
    const hard = landingInputFromDescent(plan, evaluation, {
      result: 'crashed',
      deltaVUsed: plan.nominalDeltaV,
      accuracyM: 40,
      touchdownSpeedMS: 14,
    });

    // Spending less than the allowance saves propellant; emptying the tanks is exactly descent + reserve.
    const empty = landingInputFromDescent(plan, evaluation, {
      result: 'landed',
      deltaVUsed: plan.availableDeltaV,
      accuracyM: 40,
      touchdownSpeedMS: 1.2,
    });
    const mass = evaluation.mass!;
    expect(good.descentDeltaVFactor).toBeLessThan(1);
    expect(empty.descentDeltaVFactor * mass.descentDeltaV).toBeCloseTo(
      mass.descentDeltaV + mass.reserveDeltaV,
      6,
    );
    expect(plan.availableDeltaV).toBeGreaterThan(plan.nominalDeltaV + 150);
    expect(plan.thrustAcceleration).toBeGreaterThan(plan.gravity * 2);
    const log = { landing: hard, operationsEfficiency: null, eventResponses: [] };
    let crashed = null;
    for (let seed = 0; seed < 30 && !crashed; seed++) {
      const result = simulateMission(baseline(), seed, log);
      if (result.lostIn === 'landing') crashed = result;
    }
    expect(crashed!.timeline.at(-1)!.title).toBe('Hard landing');
  });

  it('rewards a skilled crew over the scripted one on the same seed', () => {
    let pair = null;
    for (let seed = 0; seed < 30 && !pair; seed++) {
      const scripted = simulateMission(baseline(), seed);
      if (!scripted.surface) continue;
      const skilled = simulateMission(baseline(), seed, {
        landing: { descentDeltaVFactor: 0.97, accuracyM: 30, crashSpeedMS: null },
        operationsEfficiency: 1.1,
        eventResponses: [],
      });
      pair = { scripted, skilled };
    }

    expect(pair!.skilled.metrics.traverse_km).toBeGreaterThan(pair!.scripted.metrics.traverse_km);
    expect(pair!.skilled.score.total).toBeGreaterThanOrEqual(pair!.scripted.score.total);
  });

  it('runs two hundred missions in well under a second', () => {
    const started = performance.now();

    runMonteCarlo(baseline(), 200, 1);

    expect(performance.now() - started).toBeLessThan(1500);
  });
});
