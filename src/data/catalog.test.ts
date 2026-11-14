// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
import { describe, expect, it } from 'vitest';
import { BODIES, getBody } from '@/data/bodies';
import { EVENTS } from '@/data/events';
import { capacityAt, LAUNCH_VEHICLES } from '@/data/launch-vehicles';
import { MISSION_CONSTANTS, TIER_ORDER } from '@/data/mission-constants';
import { findPart, PARTS, SLOT_IDS } from '@/data/parts';
import { PLANET_ELEMENTS, PLANET_IDS } from '@/data/planet-elements';
import { SCENARIOS } from '@/data/scenarios';

const CATEGORIES = [...SLOT_IDS, 'instrument'];

describe('data catalogs', () => {
  it('gives every planet a complete, plausible element set', () => {
    expect(PLANET_IDS).toHaveLength(8);
    for (const id of PLANET_IDS) {
      const elements = PLANET_ELEMENTS[id];
      expect(elements.a[0], id).toBeGreaterThan(0.3);
      expect(elements.e[0], id).toBeGreaterThanOrEqual(0);
      expect(elements.e[0], id).toBeLessThan(0.25);
      expect(elements.meanLongitude[1], id).toBeGreaterThan(0);
    }
  });

  it('keeps body numbers physically consistent', () => {
    for (const body of BODIES) {
      expect(body.mu, body.id).toBeGreaterThan(0);
      // Surface gravity must agree with mu / r² to a few percent (oblateness, rotation).
      const gravity = body.mu / body.equatorialRadiusM ** 2;
      expect(Math.abs(gravity / body.surfaceGravityMS2 - 1), body.id).toBeLessThan(0.02);
      expect(body.solarDayS, body.id).toBeGreaterThan(0);
      const altitudes = body.atmosphereLayers.map((layer) => layer.baseAltitudeM);
      expect(altitudes, body.id).toEqual([...altitudes].sort((a, b) => a - b));
    }
  });

  it('keeps launch capacity curves ascending in x and descending in payload', () => {
    for (const vehicle of LAUNCH_VEHICLES) {
      expect(TIER_ORDER, vehicle.id).toContain(vehicle.minTier);
      expect(vehicle.costMusd, vehicle.id).toBeGreaterThan(0);
      expect(vehicle.reliability, vehicle.id).toBeGreaterThan(0.5);
      expect(vehicle.reliability, vehicle.id).toBeLessThanOrEqual(1);
      for (const curve of [vehicle.ssoCapacity, vehicle.c3Capacity]) {
        for (let i = 1; i < curve.length; i++) {
          expect(curve[i][0], vehicle.id).toBeGreaterThan(curve[i - 1][0]);
          expect(curve[i][1], vehicle.id).toBeLessThan(curve[i - 1][1]);
        }
      }
    }
  });

  it('interpolates capacity and returns zero beyond the curve', () => {
    const curve = [
      [0, 1000],
      [10, 500],
    ] as const;
    expect(capacityAt(curve, -5)).toBe(1000);
    expect(capacityAt(curve, 5)).toBe(750);
    expect(capacityAt(curve, 11)).toBe(0);
    expect(capacityAt([], 0)).toBe(0);
  });

  it('gives every part valid common fields and a trade-off summary', () => {
    for (const part of PARTS) {
      expect(CATEGORIES, part.id).toContain(part.category);
      expect(TIER_ORDER, part.id).toContain(part.minTier);
      expect(part.massKg, part.id).toBeGreaterThan(0);
      expect(part.powerW, part.id).toBeGreaterThanOrEqual(0);
      expect(part.costMusd, part.id).toBeGreaterThan(0);
      expect(part.trl, part.id).toBeGreaterThanOrEqual(4);
      expect(part.trl, part.id).toBeLessThanOrEqual(9);
      expect(part.failureRatePerYear, part.id).toBeGreaterThanOrEqual(0);
      expect(part.failureRatePerYear, part.id).toBeLessThan(0.5);
      expect(part.summary.length, part.id).toBeGreaterThan(20);
    }
  });

  it('gives every part the fields of its category in sensible ranges', () => {
    for (const part of PARTS) {
      switch (part.category) {
        case 'bus':
          expect(part.payloadCapacityKg, part.id).toBeGreaterThan(part.massKg);
          break;
        case 'power':
          if (part.powerKind === 'solar') {
            expect(part.areaM2, part.id).toBeGreaterThan(0);
            expect(part.efficiency, part.id).toBeGreaterThan(0.1);
            expect(part.efficiency, part.id).toBeLessThan(0.4);
            expect(['body', 'vertical', 'tracking_mast'], part.id).toContain(part.mounting);
          } else {
            expect(part.powerKind, part.id).toBe('rtg');
            expect(part.powerBolW, part.id).toBeGreaterThan(0);
            expect(part.decayPerYear, part.id).toBeLessThan(0.1);
            expect(part.wasteHeatW, part.id).toBeGreaterThan(part.powerBolW);
          }
          break;
        case 'battery':
          expect(part.capacityWh, part.id).toBeGreaterThan(0);
          expect(part.depthOfDischarge, part.id).toBeGreaterThan(0.3);
          expect(part.depthOfDischarge, part.id).toBeLessThanOrEqual(1);
          // Lithium-ion packs sit between roughly 80 and 250 Wh/kg.
          expect(part.capacityWh / part.massKg, part.id).toBeGreaterThan(80);
          expect(part.capacityWh / part.massKg, part.id).toBeLessThan(250);
          break;
        case 'propulsion':
          // From cold gas (about 60 s) to electric thrusters (a few thousand).
          expect(part.ispS, part.id).toBeGreaterThan(40);
          expect(part.ispS, part.id).toBeLessThan(3500);
          expect(part.thrustN, part.id).toBeGreaterThan(0);
          expect(part.tankMassFraction, part.id).toBeGreaterThan(0);
          expect(part.tankMassFraction, part.id).toBeLessThan(0.7);
          expect(part.maxCoastDays, part.id).toBeGreaterThan(0);
          break;
        case 'adcs':
          expect([1, 2, 3], part.id).toContain(part.pointingClass);
          break;
        case 'computer':
          expect(part.storageGb, part.id).toBeGreaterThan(0);
          expect(typeof part.radiationHardened, part.id).toBe('boolean');
          expect([1, 2], part.id).toContain(part.autonomy);
          break;
        case 'comms':
          expect(part.txPowerW, part.id).toBeGreaterThan(0);
          expect(part.txPowerW, part.id).toBeLessThan(part.powerW);
          expect(part.antennaDiameterM, part.id).toBeGreaterThan(0);
          expect(part.maxRateMbps, part.id).toBeGreaterThan(0);
          expect(typeof part.relay, part.id).toBe('boolean');
          break;
        case 'thermal':
          expect(part.heatLeakFactor, part.id).toBeGreaterThan(0);
          expect(part.heatLeakFactor, part.id).toBeLessThanOrEqual(1);
          expect(part.radioisotopeHeatW, part.id).toBeGreaterThanOrEqual(0);
          break;
        case 'mobility':
          expect(part.speedMPerH, part.id).toBeGreaterThan(0);
          expect(part.maxSlopeDeg, part.id).toBeGreaterThan(0);
          break;
        case 'landing':
          expect(part.descentDeltaVFactor, part.id).toBeGreaterThanOrEqual(1);
          expect(part.landingFailureRisk, part.id).toBeGreaterThan(0);
          expect(part.landingFailureRisk, part.id).toBeLessThan(0.5);
          expect(part.landingAccuracyM, part.id).toBeGreaterThan(0);
          break;
        case 'instrument':
          expect(part.dataRateMbps, part.id).toBeGreaterThan(0);
          expect(part.scienceValue, part.id).toBeGreaterThan(0);
          expect(part.measures.length, part.id).toBeGreaterThan(0);
          expect(part.drillDepthM, part.id).toBeGreaterThanOrEqual(0);
          break;
      }
    }
  });

  it('uses every part in at least one scenario', () => {
    const offered = new Set(SCENARIOS.flatMap((scenario) => scenario.catalog));
    for (const part of PARTS) expect(offered.has(part.id), part.id).toBe(true);
  });

  it('keeps every scenario reference resolvable and every slot fillable', () => {
    const eventIds = new Set(EVENTS.map((event) => event.id));
    const vehicleIds = new Set(LAUNCH_VEHICLES.map((vehicle) => vehicle.id));
    const stationIds = new Set(MISSION_CONSTANTS.groundStations.map((station) => station.id));
    for (const scenario of SCENARIOS) {
      expect(() => getBody(scenario.targetBody), scenario.id).not.toThrow();
      const parts = scenario.catalog.map((id) => findPart(id));
      expect(parts.every(Boolean), `${scenario.id} catalog`).toBe(true);
      expect(new Set(scenario.catalog).size, scenario.id).toBe(scenario.catalog.length);
      for (const slot of [...scenario.requiredSlots, ...scenario.optionalSlots]) {
        // A cadet must be able to fill every slot.
        const cadetChoices = parts.filter((part) => part?.category === slot && part.minTier === 'cadet');
        expect(cadetChoices.length, `${scenario.id} ${slot}`).toBeGreaterThan(0);
      }
      for (const id of scenario.launchVehicles) expect(vehicleIds.has(id), id).toBe(true);
      for (const id of scenario.events) expect(eventIds.has(id), id).toBe(true);
      expect(stationIds.has(scenario.operations.groundStation), scenario.id).toBe(true);
      expect(Date.parse(scenario.landingWindow.endDate), scenario.id).toBeGreaterThan(
        Date.parse(scenario.landingWindow.startDate),
      );
      expect(
        scenario.transfers.length + (scenario.route ? 1 : 0) + (scenario.orbit?.options.length ?? 0),
        scenario.id,
      ).toBeGreaterThan(0);
      for (const site of scenario.sites) {
        expect(site.horizonMaskDeg, site.id).toHaveLength(12);
        expect(Math.abs(site.latitudeDeg), site.id).toBeLessThanOrEqual(90);
        expect(site.iceQuality, site.id).toBeGreaterThan(0);
        expect(site.iceQuality, site.id).toBeLessThanOrEqual(1);
      }
      for (const entry of scenario.referenceDesign.slots) {
        expect(scenario.catalog, entry.part).toContain(entry.part);
        expect(findPart(entry.part)?.category, entry.part).toBe(entry.slot);
      }
      for (const id of scenario.referenceDesign.instruments) expect(scenario.catalog, id).toContain(id);
      expect(scenario.launchVehicles).toContain(scenario.referenceDesign.launchVehicle);
      const mountings = scenario.environment.mountingFactors.map((entry) => entry.mounting).sort();
      expect(mountings, scenario.id).toEqual(['body', 'tracking_mast', 'vertical']);
    }
  });

  it('makes every objective achievable with the scenario catalog and weights sum to one', () => {
    for (const scenario of SCENARIOS) {
      const measures = new Set(
        scenario.catalog.flatMap((id) => {
          const part = findPart(id);
          return part?.category === 'instrument' ? part.measures : [];
        }),
      );
      let weight = 0;
      for (const objective of scenario.objectives) {
        weight += objective.weight;
        expect(objective.target, objective.id).toBeGreaterThan(objective.threshold);
        for (const tag of objective.requiresMeasures) expect(measures.has(tag), tag).toBe(true);
      }
      expect(weight, scenario.id).toBeCloseTo(1, 6);
    }
  });

  it('gives every event an occurrence chance, an explanation and valid mitigations', () => {
    const used = new Set(SCENARIOS.flatMap((scenario) => scenario.events));
    for (const event of EVENTS) {
      expect(used.has(event.id), `${event.id} is used by a scenario`).toBe(true);
      expect(event.probability, event.id).toBeGreaterThanOrEqual(0);
      expect(event.probability, event.id).toBeLessThanOrEqual(1);
      expect(event.ratePerDay, event.id).toBeGreaterThanOrEqual(0);
      expect(event.unmitigatedWhy.length, event.id).toBeGreaterThan(20);
      for (const mitigation of event.mitigations) {
        expect(mitigation.why.length, event.id).toBeGreaterThan(20);
        expect(mitigation.probabilityFactor, event.id).toBeGreaterThanOrEqual(0);
        expect(mitigation.magnitudeFactor, event.id).toBeGreaterThanOrEqual(0);
        if (mitigation.condition.kind === 'has_part') {
          expect(findPart(mitigation.condition.property), event.id).toBeDefined();
        }
        if (mitigation.condition.slot) expect(CATEGORIES, event.id).toContain(mitigation.condition.slot);
      }
    }
  });

  it('orders tiers from generous to strict and covers every readiness level in use', () => {
    const tiers = MISSION_CONSTANTS.tiers;
    expect(tiers.map((tier) => tier.id)).toEqual([...TIER_ORDER]);
    for (let i = 1; i < tiers.length; i++) {
      expect(tiers[i].budgetFactor).toBeLessThan(tiers[i - 1].budgetFactor);
      expect(tiers[i].eventRateFactor).toBeGreaterThan(tiers[i - 1].eventRateFactor);
    }
    const levels = new Set(MISSION_CONSTANTS.scheduleRiskByTrl.map((entry) => entry.trl));
    for (const part of PARTS) expect(levels.has(part.trl), part.id).toBe(true);
  });
});
