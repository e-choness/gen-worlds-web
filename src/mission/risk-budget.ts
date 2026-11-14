/** Chance of losing the mission outright: launch, landing and failure of a part it cannot live without. */
import { MISSION_CONSTANTS } from '@/data/mission-constants';
import type { SlotId } from '@/data/parts';
import type { BudgetLine } from '@/mission/budget-line';
import { installedParts, type ResolvedDesign } from '@/mission/design';
import { percent } from '@/mission/format';

/** Losing one of these ends the mission; losing mobility or an instrument only shrinks it. */
const CRITICAL_SLOTS: readonly SlotId[] = ['bus', 'power', 'battery', 'computer', 'comms', 'thermal'];

const DAYS_PER_YEAR = 365.25;

export interface RiskModel {
  launchFailure: number;
  landingFailure: number;
  /** Chance that a critical part fails during the flight and surface mission. */
  hardwareFailure: number;
  /** Combined chance of losing the mission. */
  missionLoss: number;
}

export function computeRiskModel(resolved: ResolvedDesign): RiskModel {
  const { vehicle, landing, site, transfer, scenario } = resolved;
  const launchFailure = vehicle ? 1 - vehicle.reliability : 0;
  const landingFailure = landing
    ? Math.min(0.95, landing.landingFailureRisk * (site?.landingHazardFactor ?? 1))
    : 0;
  const years = ((transfer?.durationDays ?? 0) + scenario.surfaceDurationDays) / DAYS_PER_YEAR;
  let survive = 1;
  for (const item of installedParts(resolved)) {
    if (item.slot !== 'instrument' && CRITICAL_SLOTS.includes(item.slot)) {
      survive *= Math.exp(-item.failureRatePerYear * years);
    }
  }
  const hardwareFailure = 1 - survive;
  return {
    launchFailure,
    landingFailure,
    hardwareFailure,
    missionLoss: 1 - (1 - launchFailure) * (1 - landingFailure) * survive,
  };
}

export function riskLine(resolved: ResolvedDesign, model: RiskModel): BudgetLine {
  const details = [
    { label: 'Landing', value: model.landingFailure * 100, unit: '%' },
    { label: 'Launch', value: model.launchFailure * 100, unit: '%' },
    { label: 'Critical hardware', value: model.hardwareFailure * 100, unit: '%' },
  ].sort((a, b) => b.value - a.value);
  const warning = model.missionLoss > MISSION_CONSTANTS.missionLossRiskWarning;
  const { landing, site } = resolved;
  let why = `About a ${percent(model.missionLoss)} chance of losing the mission. The largest share is ${details[0].label.toLowerCase()} at ${percent(details[0].value / 100)}.`;
  if (landing && site && details[0].label === 'Landing' && site.landingHazardFactor > 1) {
    why += ` ${site.name} is rough ground: it multiplies the ${landing.name.toLowerCase()}'s risk by ${site.landingHazardFactor}.`;
  }
  if (warning) why += ' A backup unit on a critical system or a better landing sensor brings it down.';
  return {
    id: 'risk',
    label: 'Risk',
    value: model.missionLoss * 100,
    limit: null,
    unit: '% loss risk',
    margin: null,
    status: warning ? 'warning' : 'ok',
    why,
    details,
  };
}
