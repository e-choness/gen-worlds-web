// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0 or MIT: see LICENSE.md.
import { describe, expect, it } from 'vitest';
import { getScenario } from '@/data/scenarios';
import { createReferenceDesign } from '@/mission/design';
import { decodeMissionCode, encodeMissionCode } from '@/mission/mission-code';
import { simulateMission } from '@/mission/simulate-mission';

const design = createReferenceDesign(getScenario('lunar_ice_prospector'), 'engineer');

describe('mission code', () => {
  it('brings back the same design, seed and input log', () => {
    const inputLog = {
      landing: { descentDeltaVFactor: 0.98, accuracyM: 42, crashSpeedMS: null },
      operationsEfficiency: null,
      eventResponses: [{ eventId: 'Drill jam', responseSeconds: 12 }],
    };

    const decoded = decodeMissionCode(encodeMissionCode({ design, seed: 123456, inputLog }));

    expect(decoded?.design).toEqual({
      ...design,
      trajectory: { ...design.trajectory, departureJd: null, orbitId: null },
    });
    expect(decoded?.seed).toBe(123456);
    expect(decoded?.inputLog).toEqual(inputLog);
  });

  it('replays to the same score on the other side', () => {
    const original = simulateMission(design, 99);

    const decoded = decodeMissionCode(encodeMissionCode({ design, seed: 99, inputLog: null }));
    const replay = simulateMission(decoded!.design, decoded!.seed!);

    expect(replay.score.total).toBe(original.score.total);
  });

  it('carries a Mars design with its launch date', () => {
    const mars = createReferenceDesign(getScenario('mars_jezero_survey'), 'cadet');

    const decoded = decodeMissionCode(encodeMissionCode({ design: mars, seed: null, inputLog: null }));

    expect(decoded?.design.trajectory.departureJd).toBe(mars.trajectory.departureJd);
    expect(decoded?.seed).toBeNull();
  });

  it('uses only characters that survive in a link', () => {
    expect(encodeMissionCode({ design, seed: 1, inputLog: null })).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('rejects damaged codes and unknown scenarios', () => {
    const foreign = btoa(JSON.stringify({ v: 1, s: 'no_such_mission', t: 'cadet' }));

    expect(decodeMissionCode('not a code')).toBeNull();
    expect(decodeMissionCode('')).toBeNull();
    expect(decodeMissionCode(foreign)).toBeNull();
  });
});
