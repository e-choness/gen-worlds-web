// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0 or MIT: see LICENSE.md.
/** The handful of numbers shown on a part card: the common ones, then what matters for its category. */
import type { Part } from '@/data/parts';
import { money, num } from '@/mission/format';
import { TEXT } from '@/ui/text';

export interface PartStat {
  label: string;
  value: string;
}

export function partStats(part: Part): PartStat[] {
  const t = TEXT.stats;
  const stats: PartStat[] = [
    { label: t.mass, value: `${num(part.massKg)} kg` },
    { label: t.cost, value: money(part.costMusd) },
  ];
  if (part.powerW > 0) stats.push({ label: t.draw, value: `${num(part.powerW)} W` });
  switch (part.category) {
    case 'bus':
      stats.push({ label: t.carries, value: `${num(part.payloadCapacityKg)} kg` });
      break;
    case 'power':
      if (part.powerKind === 'solar') {
        stats.push({ label: t.area, value: `${num(part.areaM2)} m²` });
      } else {
        stats.push({ label: t.output, value: `${num(part.powerBolW)} W` });
        stats.push({ label: t.heat, value: `${num(part.wasteHeatW)} W` });
      }
      break;
    case 'battery':
      stats.push({
        label: t.usable,
        value: `${num((part.capacityWh * part.depthOfDischarge) / 1000, 1)} kWh`,
      });
      break;
    case 'propulsion':
      stats.push({ label: t.isp, value: `${num(part.ispS)} s` });
      stats.push({ label: t.thrust, value: `${num(part.thrustN / 1000, 1)} kN` });
      break;
    case 'adcs':
      stats.push({ label: t.pointing, value: `${t.class} ${part.pointingClass}` });
      break;
    case 'computer':
      stats.push({ label: t.storage, value: `${num(part.storageGb)} Gb` });
      stats.push({ label: t.radiation, value: part.radiationHardened ? t.hardened : t.notHardened });
      break;
    case 'comms':
      stats.push({ label: t.rate, value: `${num(part.maxRateMbps, 2)} Mbit/s` });
      if (part.needsPointingClass > 0) {
        stats.push({ label: t.needsPointing, value: `${t.class} ${part.needsPointingClass}` });
      }
      break;
    case 'thermal':
      stats.push({ label: t.heatLoss, value: `${num(part.heatLeakFactor * 100, 0)} %` });
      if (part.radioisotopeHeatW > 0)
        stats.push({ label: t.freeHeat, value: `${num(part.radioisotopeHeatW)} W` });
      break;
    case 'mobility':
      stats.push({ label: t.pace, value: `${num(part.speedMPerH)} m/h` });
      stats.push({ label: t.slope, value: `${num(part.maxSlopeDeg)}°` });
      break;
    case 'landing':
      stats.push({ label: t.accuracy, value: `${num(part.landingAccuracyM)} m` });
      stats.push({ label: t.landingRisk, value: `${num(part.landingFailureRisk * 100, 1)} %` });
      break;
    case 'instrument':
      stats.push({ label: t.data, value: `${num(part.dataRateMbps * 1000, 1)} kbit/s` });
      if (part.drillDepthM > 0) stats.push({ label: t.depth, value: `${num(part.drillDepthM)} m` });
      break;
  }
  stats.push({ label: t.readiness, value: `${part.trl} / 9` });
  return stats;
}
