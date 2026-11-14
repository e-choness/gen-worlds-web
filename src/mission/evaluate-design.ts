/**
 * One call that turns a design into everything the UI and the simulation need: the resolved parts,
 * every budget line with its explanation, the rule issues, and the derived models behind them.
 * Pure and fast (about a millisecond), so the design screen calls it on every change and on every
 * previewed change.
 */
import { type BudgetLine, worstStatus } from '@/mission/budget-line';
import {
  type CostModel,
  computeCostModel,
  computeScheduleModel,
  costLine,
  type ScheduleModel,
  scheduleLine,
} from '@/mission/cost-budget';
import { computeDataModel, type DataModel, dataLine } from '@/mission/data-budget';
import { type MissionDesign, type ResolvedDesign, resolveDesign } from '@/mission/design';
import { computeMassChain, deltaVLine, launchLine, type MassChain, massLine } from '@/mission/mass-budget';
import { computePowerModel, type PowerModel, powerLine, thermalLine } from '@/mission/power-budget';
import { computeRiskModel, type RiskModel, riskLine } from '@/mission/risk-budget';
import { computeSiteVisibility, type SiteVisibility } from '@/mission/site-visibility';
import { type DesignIssue, validateDesign } from '@/mission/validation';

export interface DesignEvaluation {
  resolved: ResolvedDesign;
  /** In display order: what you carry, how you get there, how you live there, what it costs. */
  budgets: BudgetLine[];
  issues: DesignIssue[];
  /** True when nothing blocks the launch: no error issue, no failed or incomplete budget. */
  launchable: boolean;
  mass: MassChain | null;
  power: PowerModel | null;
  visibility: SiteVisibility | null;
  data: DataModel | null;
  cost: CostModel;
  schedule: ScheduleModel;
  risk: RiskModel;
}

export function evaluateDesign(design: MissionDesign): DesignEvaluation {
  const resolved = resolveDesign(design);
  const { scenario, site } = resolved;
  const landingJd = design.trajectory.landingJd;

  const mass = computeMassChain(resolved);
  const visibility =
    site && landingJd !== null
      ? computeSiteVisibility(
          site,
          landingJd,
          scenario.surfaceDurationDays,
          scenario.operations.minSunClearanceDeg,
          scenario.operations.minEarthClearanceDeg,
          scenario.sky,
          scenario.targetBody,
        )
      : null;
  const power = computePowerModel(resolved, mass);
  const data = computeDataModel(resolved, visibility);
  const cost = computeCostModel(resolved);
  const schedule = computeScheduleModel(resolved);
  const risk = computeRiskModel(resolved);

  const budgets = [
    massLine(resolved),
    deltaVLine(resolved, mass),
    launchLine(resolved, mass),
    powerLine(resolved, power),
    thermalLine(resolved, power, visibility),
    dataLine(resolved, data),
    costLine(resolved, cost),
    scheduleLine(resolved, schedule),
    riskLine(resolved, risk),
  ];
  const issues = validateDesign(resolved);
  const worst = worstStatus(budgets.map((line) => line.status));
  const launchable =
    worst !== 'fail' && worst !== 'incomplete' && !issues.some((issue) => issue.severity === 'error');
  return { resolved, budgets, issues, launchable, mass, power, visibility, data, cost, schedule, risk };
}

export function budgetById(evaluation: DesignEvaluation, id: BudgetLine['id']): BudgetLine {
  const line = evaluation.budgets.find((candidate) => candidate.id === id);
  if (!line) throw new Error(`No budget line "${id}".`);
  return line;
}
