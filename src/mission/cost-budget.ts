/** Cost against the budget cap, and the schedule risk that unproven hardware brings. */
import { MISSION_CONSTANTS } from '@/data/mission-constants';
import type { BudgetLine } from '@/mission/budget-line';
import { installedParts, type ResolvedDesign } from '@/mission/design';
import { money, num, percent } from '@/mission/format';

const DAYS_PER_MONTH = 30.44;

export interface CostModel {
  partsMusd: number;
  launchMusd: number;
  operationsMusd: number;
  totalMusd: number;
  /** The scenario cap after the difficulty tier's factor. */
  capMusd: number;
  /** Unspent share of the cap (negative when over). */
  margin: number;
}

export function computeCostModel(resolved: ResolvedDesign): CostModel {
  const { scenario, tier, vehicle, transfer } = resolved;
  const partsMusd = installedParts(resolved).reduce((sum, item) => sum + item.costMusd, 0);
  const launchMusd = vehicle?.costMusd ?? 0;
  const months = ((transfer?.durationDays ?? 0) + scenario.surfaceDurationDays) / DAYS_PER_MONTH;
  const operationsMusd = scenario.operationsCostMusdPerMonth * months;
  const totalMusd = partsMusd + launchMusd + operationsMusd;
  const capMusd = scenario.budgetCapMusd * tier.budgetFactor;
  return { partsMusd, launchMusd, operationsMusd, totalMusd, capMusd, margin: 1 - totalMusd / capMusd };
}

export function costLine(resolved: ResolvedDesign, model: CostModel): BudgetLine {
  const reserve = MISSION_CONSTANTS.costReserveFraction;
  const priciest = installedParts(resolved).sort((a, b) => b.costMusd - a.costMusd)[0];
  const details = [
    { label: 'Spacecraft and instruments', value: model.partsMusd, unit: '$M' },
    { label: 'Launch', value: model.launchMusd, unit: '$M' },
    { label: 'Operations', value: model.operationsMusd, unit: '$M' },
  ].sort((a, b) => b.value - a.value);
  const status = model.margin < 0 ? 'fail' : model.margin < reserve ? 'warning' : 'ok';
  let why: string;
  if (status === 'fail') {
    why = `The mission costs ${money(model.totalMusd)} against a cap of ${money(model.capMusd)}: ${money(model.totalMusd - model.capMusd)} over.${priciest ? ` The most expensive item is the ${priciest.part.name.toLowerCase()} at ${money(priciest.costMusd)}.` : ''}${resolved.vehicle ? ` The launch is ${money(model.launchMusd)}.` : ''}`;
  } else if (status === 'warning') {
    why = `${money(model.totalMusd)} of ${money(model.capMusd)} is committed, leaving ${percent(model.margin)} in reserve. NASA projects hold about ${percent(reserve)}: with less, one budget cut or one late part forces you to remove something.`;
  } else {
    why = `${money(model.totalMusd)} of ${money(model.capMusd)} is committed, leaving ${percent(model.margin)} in reserve to absorb cuts and surprises. Unspent budget also raises the efficiency score.`;
  }
  return {
    id: 'cost',
    label: 'Budget',
    value: model.totalMusd,
    limit: model.capMusd,
    unit: '$M',
    margin: model.margin,
    status,
    why,
    details,
  };
}

/** Chance that one part at this readiness level arrives late (0 for unlisted levels). */
export function slipProbabilityForTrl(trl: number): number {
  return MISSION_CONSTANTS.scheduleRiskByTrl.find((entry) => entry.trl === trl)?.slipProbability ?? 0;
}

export interface ScheduleModel {
  /** Chance that at least one part arrives late and the launch slips. */
  slipProbability: number;
}

export function computeScheduleModel(resolved: ResolvedDesign): ScheduleModel {
  let onTime = 1;
  for (const item of installedParts(resolved)) onTime *= 1 - slipProbabilityForTrl(item.part.trl);
  return { slipProbability: 1 - onTime };
}

export function scheduleLine(resolved: ResolvedDesign, model: ScheduleModel): BudgetLine {
  const risky = installedParts(resolved)
    .filter((item) => slipProbabilityForTrl(item.part.trl) > 0)
    .sort((a, b) => a.part.trl - b.part.trl);
  const details = risky.slice(0, 3).map((item) => ({
    label: `${item.part.name} (readiness ${item.part.trl})`,
    value: item.part.trl,
    unit: 'TRL',
  }));
  const warning = model.slipProbability > MISSION_CONSTANTS.scheduleSlipWarning;
  let why: string;
  if (risky.length === 0) {
    why = 'Every part has flown before (readiness level 9), so the hardware should be ready on time.';
  } else if (warning) {
    why = `There is a ${percent(model.slipProbability)} chance of missing the launch date. The least proven part is the ${risky[0].part.name.toLowerCase()} (readiness level ${risky[0].part.trl} of 9). A slip moves the landing a month, into different lighting.`;
  } else {
    why = `${num(risky.length, 0)} part${risky.length === 1 ? ' has' : 's have'} not fully flown yet, giving a ${percent(model.slipProbability)} chance of a launch slip.`;
  }
  return {
    id: 'schedule',
    label: 'Schedule',
    value: model.slipProbability * 100,
    limit: null,
    unit: '% slip risk',
    margin: null,
    status: warning ? 'warning' : 'ok',
    why,
    details,
  };
}
