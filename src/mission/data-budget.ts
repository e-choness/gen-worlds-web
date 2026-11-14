/**
 * Data: what the instruments produce against what the radio can send home, and whether the
 * recorder can hold the backlog while Earth is out of view.
 */
import { AU, SPEED_OF_LIGHT } from '@/astro/constants';
import { getGroundStation, MISSION_CONSTANTS } from '@/data/mission-constants';
import type { CommsPart } from '@/data/parts';
import { type BudgetLine, incompleteLine } from '@/mission/budget-line';
import type { ResolvedDesign } from '@/mission/design';
import { duration, num, percent } from '@/mission/format';
import type { SiteVisibility } from '@/mission/site-visibility';

/** Megabits per second × seconds → gigabits. */
const GB_PER_MBPS_DAY = 86400 / 1000;

/**
 * Downlink rate of a radio over a distance: scales from the reference link with transmitter power,
 * the area of both antennas and the inverse square of distance, capped by the radio hardware.
 */
export function linkRateMbps(comms: CommsPart, distanceAu: number, groundAntennaDiameterM: number): number {
  const ref = MISSION_CONSTANTS.linkReference;
  const rateBps =
    ref.rateBps *
    (comms.txPowerW / ref.txPowerW) *
    (comms.antennaDiameterM / ref.antennaDiameterM) ** 2 *
    (groundAntennaDiameterM / ref.groundAntennaDiameterM) ** 2 *
    (ref.distanceAu / distanceAu) ** 2;
  return Math.min(rateBps / 1e6, comms.maxRateMbps);
}

export interface DataModel {
  /** Rate while the instruments run, Mbit/s. */
  instrumentRateMbps: number;
  /** Downlink rate while in contact, Mbit/s (0 when the antenna cannot be pointed). */
  linkRateMbps: number;
  /** Share of time in contact with Earth or the relay. */
  contactFraction: number;
  /** Share of time the vehicle is awake and working. */
  workFraction: number;
  generatedGbPerDay: number;
  downlinkGbPerDay: number;
  storageGb: number;
  /** Longest gap without contact, hours. */
  longestOutageHours: number;
  /** One-way signal travel time, s. */
  lightTimeS: number;
}

/** Null until comms, a computer and a site are chosen. */
export function computeDataModel(
  resolved: ResolvedDesign,
  visibility: SiteVisibility | null,
): DataModel | null {
  const { comms, computer, scenario, power } = resolved;
  if (!comms || !computer || !visibility) return null;
  const ops = scenario.operations;
  const station = getGroundStation(ops.groundStation);
  const pointed = (resolved.adcs?.pointingClass ?? 0) >= comms.needsPointingClass;
  const earthDistanceAu = visibility.earthDistanceAu ?? scenario.environment.earthDistanceAu;
  // A relay orbiter carries the long haul to Earth: the vehicle only has to reach the orbiter.
  const rate = !pointed
    ? 0
    : comms.relay
      ? comms.maxRateMbps
      : linkRateMbps(comms, earthDistanceAu, station.antennaDiameterM);
  const availability = comms.relay
    ? ops.relayCoverageFraction
    : visibility.earthFraction * Math.min(1, ops.groundPassHoursPerDay / 24 / ops.commsFraction);
  const contactFraction = ops.commsFraction * Math.min(1, availability);
  // A solar vehicle sleeps through darkness; a radioisotope one works around the clock.
  const workFraction = power?.powerKind === 'rtg' ? 1 : visibility.sunFraction;
  const instrumentRateMbps = resolved.instruments.reduce(
    (sum, instrument) => sum + instrument.dataRateMbps,
    0,
  );
  return {
    instrumentRateMbps,
    linkRateMbps: rate,
    contactFraction,
    workFraction,
    generatedGbPerDay: instrumentRateMbps * ops.scienceFraction * workFraction * GB_PER_MBPS_DAY,
    downlinkGbPerDay: rate * contactFraction * GB_PER_MBPS_DAY,
    storageGb: computer.storageGb,
    longestOutageHours: comms.relay ? 0 : visibility.longestEarthOutageHours,
    lightTimeS: (earthDistanceAu * AU) / SPEED_OF_LIGHT,
  };
}

export function dataLine(resolved: ResolvedDesign, model: DataModel | null): BudgetLine {
  const { comms, computer, adcs } = resolved;
  if (!model || !comms || !computer) {
    return incompleteLine(
      'data',
      'Data',
      'Gb/day',
      'Choose a radio, a computer and a landing site to compare the data produced with the data sent home.',
    );
  }
  const details = resolved.instruments
    .map((instrument) => ({ label: instrument.name, value: instrument.dataRateMbps * 1000, unit: 'kbit/s' }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 3);
  const base = {
    id: 'data' as const,
    label: 'Data',
    unit: 'Gb/day',
    value: model.generatedGbPerDay,
    limit: model.downlinkGbPerDay,
    details,
  };
  if (model.linkRateMbps === 0) {
    return {
      ...base,
      margin: -1,
      status: 'fail',
      why: `The ${comms.name.toLowerCase()} has a narrow beam that needs pointing class ${comms.needsPointingClass}, and ${adcs ? `the ${adcs.name.toLowerCase()} only reaches class ${adcs.pointingClass}` : 'there is no attitude control yet'}. It cannot be kept on Earth: nothing would come home.`,
    };
  }
  if (model.downlinkGbPerDay === 0) {
    return {
      ...base,
      margin: -1,
      status: 'fail',
      why: `Earth never rises above the horizon at ${resolved.site?.name ?? 'this site'} in this period, so a direct link has no contact at all. A relay satellite is the only way to get data out.`,
    };
  }
  const margin = 1 - model.generatedGbPerDay / model.downlinkGbPerDay;
  const link = `The ${comms.name.toLowerCase()} sends ${num(model.linkRateMbps, 2)} Mbit/s and is in contact ${percent(model.contactFraction)} of the time: ${num(model.downlinkGbPerDay)} Gb a day`;
  if (margin < 0) {
    const worst = details[0];
    return {
      ...base,
      margin,
      status: 'warning',
      why: `The instruments produce ${num(model.generatedGbPerDay)} Gb a day. ${link}. The other ${percent(-margin / (1 - margin))} never reaches Earth${worst ? `; the ${worst.label.toLowerCase()} is the biggest producer` : ''}.`,
    };
  }
  // The recorder has to hold what is produced while Earth is out of view.
  const backlogGb = (model.generatedGbPerDay * model.longestOutageHours) / 24;
  if (backlogGb > model.storageGb) {
    return {
      ...base,
      margin,
      status: 'warning',
      why: `${link}, more than the ${num(model.generatedGbPerDay)} Gb produced. But Earth stays out of view for up to ${duration(model.longestOutageHours)}, when ${num(backlogGb)} Gb pile up, and the ${computer.name.toLowerCase()} stores ${num(model.storageGb)} Gb. The overflow is lost.`,
    };
  }
  return {
    ...base,
    margin,
    status: 'ok',
    why: `${link}, against ${num(model.generatedGbPerDay)} Gb produced. The recorder (${num(model.storageGb)} Gb) covers the longest gap in contact.`,
  };
}
