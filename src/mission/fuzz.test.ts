// Gen Worlds © 2026 Echo Yin. PolyForm Noncommercial 1.0.0: see LICENSE.md.
/**
 * Random designs through the whole mission model: whatever the player assembles, the budgets must
 * come back finite and explained, and a launchable design must fly to a finite, repeatable result.
 */
import { describe, expect, it } from 'vitest';
import { Rng } from '@/core/random';
import { TIER_ORDER, type TierId } from '@/data/mission-constants';
import { SLOT_IDS, type SlotId } from '@/data/parts';
import { SCENARIOS, type Scenario } from '@/data/scenarios';
import { availableParts, createReferenceDesign, type MissionDesign } from '@/mission/design';
import { evaluateDesign } from '@/mission/evaluate-design';
import { simulateMission } from '@/mission/simulate-mission';

function pick<T>(rng: Rng, items: readonly T[]): T | undefined {
  return items.length > 0 ? items[rng.int(0, items.length - 1)] : undefined;
}

/** The reference design with `changes` random edits: part swaps, empty slots, routes and dates. */
function mutate(scenario: Scenario, tier: TierId, rng: Rng, changes: number): MissionDesign {
  const design = structuredClone(createReferenceDesign(scenario, tier));
  for (let i = 0; i < changes; i++) {
    const roll = rng.int(0, 9);
    if (roll <= 3) {
      const slot = pick(rng, SLOT_IDS) as SlotId;
      const part = pick(rng, availableParts(scenario, tier, slot));
      if (part && rng.next() > 0.1) design.slots[slot] = part.id;
      else delete design.slots[slot];
    } else if (roll === 4) {
      const part = pick(rng, availableParts(scenario, tier, 'instrument'));
      if (part && design.instruments.length < 8) design.instruments.push(part.id);
    } else if (roll === 5) {
      design.instruments.splice(rng.int(0, Math.max(0, design.instruments.length - 1)), 1);
    } else if (roll === 6) {
      const slot = pick(rng, SLOT_IDS) as SlotId;
      if (!design.redundant.includes(slot)) design.redundant.push(slot);
    } else if (roll === 7) {
      design.trajectory.launchVehicleId = pick(rng, scenario.launchVehicles) ?? null;
      design.trajectory.transferId = pick(rng, scenario.transfers)?.id ?? null;
      design.trajectory.siteId = pick(rng, scenario.sites)?.id ?? null;
      design.trajectory.orbitId = pick(rng, scenario.orbit?.options ?? [])?.id ?? null;
    } else if (roll === 8) {
      if (design.trajectory.landingJd !== null) design.trajectory.landingJd += rng.range(-400, 400);
      if (design.trajectory.departureJd) design.trajectory.departureJd += rng.range(-400, 400);
    } else {
      design.trajectory.landingJd = rng.next() > 0.5 ? null : design.trajectory.landingJd;
    }
  }
  return design;
}

function expectFinite(value: unknown, path: string): void {
  if (typeof value === 'number') {
    // Infinity is a legitimate "never" (an orbit that does not decay); NaN never is.
    expect(Number.isNaN(value), path).toBe(false);
  } else if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) expectFinite(item, `${path}[${index}]`);
  } else if (value && typeof value === 'object' && !ArrayBuffer.isView(value)) {
    for (const [key, item] of Object.entries(value)) expectFinite(item, `${path}.${key}`);
  } else if (typeof value === 'string') {
    expect(value, path).not.toMatch(/NaN|undefined|\[object|Infinity/);
  }
}

describe('random designs', () => {
  for (const scenario of SCENARIOS) {
    for (const tier of TIER_ORDER) {
      it(`${scenario.id} at ${tier} evaluates and flies without a broken number`, () => {
        const rng = new Rng(SCENARIOS.indexOf(scenario) * 31 + TIER_ORDER.indexOf(tier) + 7);
        let flown = 0;

        for (let i = 0; i < 60; i++) {
          const design = mutate(scenario, tier, rng, rng.int(0, 5));
          const label = `${scenario.id}/${tier} #${i} ${JSON.stringify(design)}`;
          const evaluation = evaluateDesign(design);
          expectFinite(evaluation.budgets, `${label} budgets`);
          expectFinite(evaluation.issues, `${label} issues`);
          for (const line of evaluation.budgets) expect(line.why.length, label).toBeGreaterThan(0);
          if (!evaluation.launchable) continue;
          flown++;
          const seed = rng.nextU32();
          const result = simulateMission(design, seed);
          const { surface, ...summary } = result;
          expectFinite(summary, `${label} seed ${seed} result`);
          expectFinite(surface?.end, `${label} seed ${seed} end`);
          expect(result.score.total, label).toBeGreaterThanOrEqual(0);
          expect(result.headline.length, label).toBeGreaterThan(0);
          for (const value of Object.values(result.metrics)) expect(value, label).toBeGreaterThanOrEqual(0);
          expect(JSON.stringify(simulateMission(design, seed).score), label).toBe(
            JSON.stringify(result.score),
          );
        }

        expect(flown).toBeGreaterThan(5);
      });
    }
  }
});
