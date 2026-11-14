import { describe, expect, it } from 'vitest';
import { jdFromDate } from '@/astro/time';
import { getScenario } from '@/data/scenarios';
import { createReferenceDesign, type MissionDesign } from '@/mission/design';
import { evaluateDesign } from '@/mission/evaluate-design';
import { runMonteCarlo } from '@/mission/monte-carlo';
import { simulateMission } from '@/mission/simulate-mission';

function baseline(): MissionDesign {
  return createReferenceDesign(getScenario('mars_jezero_survey'), 'engineer');
}

describe('Mars scenario', () => {
  it('launches the reference design with every budget healthy', () => {
    const evaluation = evaluateDesign(baseline());

    expect(evaluation.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
    expect(evaluation.launchable).toBe(true);
  });

  it('derives the launch energy and entry speed from the chosen dates', () => {
    const { transfer, arrival } = evaluateDesign(baseline()).resolved;

    // The 2028 window: about 9 km²/s² and an entry near 5.8 km/s.
    expect(transfer!.c3Km2S2).toBeGreaterThan(7);
    expect(transfer!.c3Km2S2).toBeLessThan(13);
    expect(arrival!.entrySpeedMS).toBeGreaterThan(5400);
    expect(arrival!.entrySpeedMS).toBeLessThan(6100);
  });

  it('blocks a launch whose arrival is too fast for the heat shield', () => {
    const design = baseline();
    const late: MissionDesign = {
      ...design,
      trajectory: {
        ...design.trajectory,
        departureJd: jdFromDate(2029, 2, 28),
        landingJd: jdFromDate(2029, 8, 30),
      },
    };

    const evaluation = evaluateDesign(late);

    expect(evaluation.issues.map((issue) => issue.code)).toContain('entry_too_fast');
    expect(evaluation.launchable).toBe(false);
  });

  it('gives the rover a night every sol and Earth farther than one au', () => {
    const visibility = evaluateDesign(baseline()).visibility!;

    expect(visibility.sunFraction).toBeGreaterThan(0.3);
    expect(visibility.sunFraction).toBeLessThan(0.55);
    expect(visibility.longestDarkHours).toBeLessThan(20);
    expect(visibility.earthDistanceAu).toBeGreaterThan(1);
  });

  it('sends megabits through the relay and kilobits straight to Earth', () => {
    const design = baseline();
    const direct: MissionDesign = { ...design, slots: { ...design.slots, comms: 'comms_high_gain' } };

    const relayRate = evaluateDesign(design).data!.linkRateMbps;
    const directRate = evaluateDesign(direct).data!.linkRateMbps;

    expect(relayRate).toBe(2);
    expect(directRate).toBeLessThan(0.05);
  });

  it('returns the identical result for the same seed', () => {
    expect(simulateMission(baseline(), 77)).toEqual(simulateMission(baseline(), 77));
  });

  it('succeeds most of the time with the reference design and never always', () => {
    const summary = runMonteCarlo(baseline(), 200, 5);

    expect(summary.successShare).toBeGreaterThan(0.4);
    expect(summary.successShare).toBeLessThan(0.98);
  });
});
