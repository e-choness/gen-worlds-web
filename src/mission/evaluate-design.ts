// Gen Worlds © 2026 Echo Yin. PolyForm Noncommercial 1.0.0: see LICENSE.md.
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
import {
  computeOrbitMassChain,
  eclipseLine,
  orbitDeltaVLine,
  orbitLaunchLine,
  orbitPowerLine,
  orbitVisibility,
} from '@/mission/orbit-budgets';
import { computeOrbitModel, type OrbitModel } from '@/mission/orbit-model';
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
  /** The orbit of a mission flown in orbit; null for a lander or before an orbit is chosen. */
  orbit: OrbitModel | null;
  data: DataModel | null;
  cost: CostModel;
  schedule: ScheduleModel;
  risk: RiskModel;
}

export function evaluateDesign(design: MissionDesign): DesignEvaluation {
  const resolved = resolveDesign(design);
  const { scenario, site } = resolved;
  const landingJd = design.trajectory.landingJd;

  const orbit = computeOrbitModel(resolved);
  const mass = scenario.orbit ? computeOrbitMassChain(resolved, orbit) : computeMassChain(resolved);
  const visibility = scenario.orbit
    ? orbit && orbitVisibility(orbit, scenario.surfaceDurationDays)
    : site && landingJd !== null
      ? computeSiteVisibility(
          site,
          landingJd,
          scenario.surfaceDurationDays,
          scenario.operations.minSunClearanceDeg,
          scenario.operations.minEarthClearanceDeg,
          scenario.sky,
          scenario.targetBody,
          scenario.environment.earthDistanceAu,
        )
      : null;
  const power = computePowerModel(resolved, mass);
  const data = computeDataModel(resolved, visibility);
  const cost = computeCostModel(resolved);
  const schedule = computeScheduleModel(resolved);
  const risk = computeRiskModel(resolved);

  const budgets = [
    massLine(resolved),
    scenario.orbit ? orbitDeltaVLine(resolved, mass, orbit) : deltaVLine(resolved, mass),
    scenario.orbit ? orbitLaunchLine(resolved, mass, orbit) : launchLine(resolved, mass),
    scenario.orbit ? orbitPowerLine(resolved, power, orbit) : powerLine(resolved, power),
    scenario.orbit ? eclipseLine(resolved, power, orbit) : thermalLine(resolved, power, visibility),
    dataLine(resolved, data),
    costLine(resolved, cost),
    scheduleLine(resolved, schedule),
    riskLine(resolved, risk),
  ];
  const issues = validateDesign(resolved);
  const worst = worstStatus(budgets.map((line) => line.status));
  const launchable =
    worst !== 'fail' && worst !== 'incomplete' && !issues.some((issue) => issue.severity === 'error');
  return {
    resolved,
    budgets,
    issues,
    launchable,
    mass,
    power,
    visibility,
    orbit,
    data,
    cost,
    schedule,
    risk,
  };
}

export function budgetById(evaluation: DesignEvaluation, id: BudgetLine['id']): BudgetLine {
  const line = evaluation.budgets.find((candidate) => candidate.id === id);
  if (!line) throw new Error(`No budget line "${id}".`);
  return line;
}
