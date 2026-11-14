// Gen Worlds © 2026 Echo Yin. PolyForm Noncommercial 1.0.0: see LICENSE.md.
/**
 * Design rules that are not budgets: missing choices, parts that do not fit together, and
 * objectives the design cannot reach. Each issue says what is wrong and what would fix it.
 */
import { jdFromUnixMs } from '@/astro/time';
import { tierAllows } from '@/data/mission-constants';
import type { PartCategory } from '@/data/parts';
import { installedParts, type ResolvedDesign } from '@/mission/design';
import { num } from '@/mission/format';
import { measureName, SLOT_NAMES } from '@/mission/slot-names';

export interface DesignIssue {
  /** Errors block the launch; warnings cost score or risk but may be accepted. */
  severity: 'error' | 'warning';
  /** Stable identifier for tests and for co-op routing. */
  code: string;
  /** The part of the design the issue is about, when there is one. */
  slot: PartCategory | 'trajectory' | null;
  message: string;
}

/** Julian dates between which the scenario allows a landing. */
export function landingWindowJd(resolved: ResolvedDesign): { start: number; end: number } {
  const { startDate, endDate } = resolved.scenario.landingWindow;
  return { start: jdFromUnixMs(Date.parse(startDate)), end: jdFromUnixMs(Date.parse(endDate)) };
}

export function validateDesign(resolved: ResolvedDesign): DesignIssue[] {
  const { scenario, design, tier } = resolved;
  const issues: DesignIssue[] = [];

  for (const slot of scenario.requiredSlots) {
    if (!resolved[slot]) {
      issues.push({
        severity: 'error',
        code: `missing_${slot}`,
        slot,
        message: `${SLOT_NAMES[slot]}: nothing chosen yet. The spacecraft cannot fly without it.`,
      });
    }
  }

  for (const item of installedParts(resolved)) {
    if (!tierAllows(tier.id, item.part.minTier)) {
      issues.push({
        severity: 'error',
        code: 'tier_locked',
        slot: item.slot,
        message: `The ${item.part.name.toLowerCase()} is not available at the ${tier.name} level.`,
      });
    }
  }

  if (resolved.instruments.length === 0) {
    issues.push({
      severity: 'error',
      code: 'no_instruments',
      slot: 'instrument',
      message: 'No instruments chosen. A mission without a payload returns no science.',
    });
  }
  if (resolved.instruments.length > scenario.maxInstruments) {
    issues.push({
      severity: 'error',
      code: 'too_many_instruments',
      slot: 'instrument',
      message: `The vehicle has mounting points for ${scenario.maxInstruments} instruments and ${resolved.instruments.length} are chosen.`,
    });
  }

  const { vehicle, transfer, site } = resolved;
  if (scenario.orbit) {
    if (!vehicle || !resolved.orbit) {
      const missing = [!vehicle && 'a launch vehicle', !resolved.orbit && 'an orbit'].filter(Boolean);
      issues.push({
        severity: 'error',
        code: 'trajectory_incomplete',
        slot: 'trajectory',
        message: `The trajectory still needs ${missing.join(' and ')}.`,
      });
    } else {
      const scale = resolved.orbit.altitudeKm / 500;
      for (const instrument of resolved.instruments) {
        const gsd = instrument.gsdMAt500 * scale;
        if (instrument.swathKmAt500 > 0 && gsd > scenario.orbit.requiredGsdM) {
          issues.push({
            severity: 'warning',
            code: 'imager_too_coarse',
            slot: 'trajectory',
            message: `From ${num(resolved.orbit.altitudeKm)} km the ${instrument.name.toLowerCase()} resolves ${num(gsd, 1)} m, and the imaging objective needs ${num(scenario.orbit.requiredGsdM)} m or better. Its pictures will not count: fly lower or carry a sharper imager.`,
          });
        }
      }
    }
  } else if (!vehicle || !transfer || !site || design.trajectory.landingJd === null) {
    const missing = [
      !vehicle && 'a launch vehicle',
      !transfer && (scenario.route ? 'a launch date and a landing date' : 'a transfer'),
      !site && 'a landing site',
      design.trajectory.landingJd === null && !scenario.route && 'a landing date',
    ].filter(Boolean);
    issues.push({
      severity: 'error',
      code: 'trajectory_incomplete',
      slot: 'trajectory',
      message: `The trajectory still needs ${missing.join(', ')}.`,
    });
  } else {
    if (!tierAllows(tier.id, vehicle.minTier)) {
      issues.push({
        severity: 'error',
        code: 'tier_locked',
        slot: 'trajectory',
        message: `${vehicle.name} is not available at the ${tier.name} level.`,
      });
    }
    const window = landingWindowJd(resolved);
    if (design.trajectory.landingJd < window.start || design.trajectory.landingJd > window.end) {
      issues.push({
        severity: 'error',
        code: 'landing_outside_window',
        slot: 'trajectory',
        message: `The landing date must fall between ${scenario.landingWindow.startDate} and ${scenario.landingWindow.endDate}.`,
      });
    }
    const { route, entry } = scenario;
    const departureJd = design.trajectory.departureJd;
    if (route && departureJd != null) {
      const start = jdFromUnixMs(Date.parse(route.departureWindow.startDate));
      const end = jdFromUnixMs(Date.parse(route.departureWindow.endDate));
      if (departureJd < start || departureJd > end) {
        issues.push({
          severity: 'error',
          code: 'launch_outside_window',
          slot: 'trajectory',
          message: `The launch date must fall between ${route.departureWindow.startDate} and ${route.departureWindow.endDate}.`,
        });
      }
    }
    const arrival = resolved.arrival;
    if (entry && arrival && arrival.entrySpeedMS > entry.maxEntrySpeedMS) {
      issues.push({
        severity: 'error',
        code: 'entry_too_fast',
        slot: 'trajectory',
        message: `On these dates the spacecraft meets ${scenario.terms.destination} at ${num(arrival.vInfinityMS / 1000, 1)} km/s and hits the atmosphere at ${num(arrival.entrySpeedMS / 1000, 1)} km/s. The heat shield survives ${num(entry.maxEntrySpeedMS / 1000, 1)} km/s: choose dates with a slower arrival.`,
      });
    }
  }

  const pointing = resolved.adcs?.pointingClass ?? 0;
  for (const instrument of resolved.instruments) {
    if (instrument.needsPointingClass > pointing) {
      issues.push({
        severity: 'warning',
        code: 'instrument_pointing',
        slot: 'adcs',
        message: `The ${instrument.name.toLowerCase()} needs pointing class ${instrument.needsPointingClass} and the attitude control gives class ${pointing}: its data will be blurred and worth little.`,
      });
    }
  }

  for (const objective of scenario.objectives) {
    const missing = objective.requiresMeasures.filter((tag) => !resolved.measures.has(tag));
    if (missing.length > 0 && resolved.instruments.length > 0) {
      issues.push({
        severity: 'warning',
        code: `objective_uncovered_${objective.id}`,
        slot: 'instrument',
        message: `"${objective.name}" needs ${missing.map(measureName).join(' and ')}, which no chosen instrument provides. This objective (${num(objective.weight * 100, 0)} % of the science) will score nothing.`,
      });
    }
  }

  if (site && site.shadowDistanceKm > 0 && !scenario.orbit) {
    const { mobility } = resolved;
    if (!mobility) {
      issues.push({
        severity: 'warning',
        code: 'no_mobility',
        slot: 'mobility',
        message: `Without wheels the vehicle stays where it lands, and ${scenario.terms.targetShort} at ${site.name} is ${num(site.shadowDistanceKm)} km away. It can only sample the ground under it.`,
      });
    } else if (mobility.maxSlopeDeg < site.slopeDeg) {
      issues.push({
        severity: 'warning',
        code: 'slope_too_steep',
        slot: 'mobility',
        message: `The way to ${scenario.terms.targetShort} at ${site.name} has slopes of ${num(site.slopeDeg, 0)}° and the ${mobility.name.toLowerCase()} climbs ${num(mobility.maxSlopeDeg, 0)}°. The rover cannot get to ${scenario.terms.targetGround}.`,
      });
    }
  }

  return issues;
}
