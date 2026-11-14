import { useMemo } from 'preact/hooks';
import { isoDateFromJd } from '@/astro/time';
import { capacityAt, getLaunchVehicle } from '@/data/launch-vehicles';
import { tierAllows } from '@/data/mission-constants';
import type { MissionDesign, TrajectoryChoice } from '@/mission/design';
import { type DesignEvaluation, evaluateDesign } from '@/mission/evaluate-design';
import { money, num, percent } from '@/mission/format';
import { type BudgetChange, previewChanges } from '@/mission/preview';
import { computeSiteCalendar } from '@/mission/site-calendar';
import { landingWindowJd } from '@/mission/validation';
import { BudgetPanel } from '@/ui/budget-panel';
import { CapacityChart } from '@/ui/charts/capacity-chart';
import { SkyCalendar } from '@/ui/charts/sky-calendar';
import { ChoiceCard, type ChoiceStat } from '@/ui/choice-card';
import { TEXT } from '@/ui/text';

export interface TrajectoryScreenProps {
  evaluation: DesignEvaluation;
  onChange: (change: Partial<TrajectoryChoice>) => void;
  onNext: () => void;
  onBack: () => void;
}

/** How to get there and when: rocket, route, landing site and landing date, each with its effect. */
export function TrajectoryScreen({ evaluation, onChange, onNext, onBack }: TrajectoryScreenProps) {
  const { resolved, mass } = evaluation;
  const { scenario, design, transfer, site, vehicle } = resolved;
  const t = TEXT.trajectory;
  const window = landingWindowJd(resolved);
  const windowDays = Math.round(window.end - window.start);
  const landingJd = design.trajectory.landingJd;
  const landingDay = landingJd === null ? null : Math.round(landingJd - window.start);

  const preview = (change: Partial<TrajectoryChoice>): BudgetChange[] => {
    const candidate: MissionDesign = { ...design, trajectory: { ...design.trajectory, ...change } };
    return previewChanges(evaluation, evaluateDesign(candidate)).slice(0, 4);
  };
  // Previews depend on the whole design, so recompute them whenever it changes.
  const previews = useMemo(
    () => ({
      vehicles: new Map(scenario.launchVehicles.map((id) => [id, preview({ launchVehicleId: id })])),
      transfers: new Map(scenario.transfers.map((option) => [option.id, preview({ transferId: option.id })])),
      sites: new Map(scenario.sites.map((option) => [option.id, preview({ siteId: option.id })])),
    }),
    [evaluation],
  );
  const calendar = useMemo(
    () =>
      site
        ? computeSiteCalendar(
            site,
            window.start,
            windowDays + scenario.surfaceDurationDays,
            scenario.operations.minSunClearanceDeg,
            scenario.operations.minEarthClearanceDeg,
          )
        : null,
    [site, window.start, windowDays, scenario],
  );

  const vehicles = scenario.launchVehicles
    .map((id) => getLaunchVehicle(id))
    .filter((option) => tierAllows(design.tier, option.minTier));
  const neededKg = mass?.feasible ? mass.wetMassKg + scenario.launchAdapterMassKg : null;

  return (
    <section class="screen wide trajectory">
      <div class="trajectory-main">
        <h2>{t.vehicle}</h2>
        <div class="split">
          <ul class="part-list">
            {vehicles.map((option, index) => {
              const stats: ChoiceStat[] = [
                { label: t.cost, value: money(option.costMusd) },
                { label: t.reliability, value: percent(option.reliability) },
              ];
              if (transfer) {
                stats.push({
                  label: t.lifts,
                  value: `${num(capacityAt(option.c3Capacity, transfer.c3Km2S2))} kg`,
                });
              }
              return (
                <li key={option.id}>
                  <ChoiceCard
                    title={option.name}
                    eyebrow={option.provider}
                    summary={option.summary}
                    stats={stats}
                    selected={vehicle?.id === option.id}
                    changes={previews.vehicles.get(option.id) ?? []}
                    autofocus={index === 0}
                    onChoose={() => onChange({ launchVehicleId: option.id })}
                  />
                </li>
              );
            })}
          </ul>
          <CapacityChart
            vehicles={vehicles}
            selectedId={vehicle?.id ?? null}
            c3={transfer?.c3Km2S2 ?? null}
            neededKg={neededKg}
          />
        </div>

        <h2>{t.transfer}</h2>
        <ul class="part-list two">
          {scenario.transfers.map((option) => (
            <li key={option.id}>
              <ChoiceCard
                title={option.name}
                summary={option.summary}
                stats={[
                  { label: t.duration, value: `${num(option.durationDays)} ${t.days}` },
                  { label: t.energy, value: `${num(option.c3Km2S2, 1)} km²/s²` },
                  {
                    label: t.braking,
                    value: `${num(option.orbitInsertionDeltaVMS + option.correctionDeltaVMS)} m/s`,
                  },
                ]}
                selected={transfer?.id === option.id}
                changes={previews.transfers.get(option.id) ?? []}
                onChoose={() => onChange({ transferId: option.id })}
              />
            </li>
          ))}
        </ul>

        <h2>{t.site}</h2>
        <ul class="part-list three">
          {scenario.sites.map((option) => (
            <li key={option.id}>
              <ChoiceCard
                title={option.name}
                eyebrow={`${num(Math.abs(option.latitudeDeg), 2)}° S`}
                summary={option.summary}
                stats={[
                  { label: t.ice, value: percent(option.iceQuality) },
                  {
                    label: t.toIce,
                    value: option.shadowDistanceKm > 0 ? `${num(option.shadowDistanceKm)} km` : t.inIce,
                  },
                  { label: t.hazard, value: `× ${num(option.landingHazardFactor, 1)}` },
                  { label: t.slope, value: `${num(option.slopeDeg)}°` },
                ]}
                selected={site?.id === option.id}
                changes={previews.sites.get(option.id) ?? []}
                onChoose={() => onChange({ siteId: option.id })}
              />
            </li>
          ))}
        </ul>

        <h2>{t.date}</h2>
        {calendar ? (
          <div class="date-picker">
            <SkyCalendar
              calendar={calendar}
              landingDay={landingDay}
              missionDays={scenario.surfaceDurationDays}
              windowDays={windowDays}
            >
              <input
                type="range"
                aria-label={t.date}
                min={0}
                max={windowDays}
                step={1}
                value={landingDay ?? 0}
                onInput={(event) => onChange({ landingJd: window.start + Number(event.currentTarget.value) })}
              />
            </SkyCalendar>
            <p class="date-readout">
              {landingJd === null ? (
                <span class="dim">{t.dateHint}</span>
              ) : (
                <>
                  <strong>
                    {t.landing} {isoDateFromJd(landingJd)}
                  </strong>
                  {transfer && (
                    <span class="dim">
                      {' '}
                      · {t.launch} {isoDateFromJd(landingJd - transfer.durationDays)}
                    </span>
                  )}
                </>
              )}
            </p>
          </div>
        ) : (
          <p class="hint">{t.siteFirst}</p>
        )}

        <div class="actions">
          <button type="button" class="button" onClick={onBack}>
            {TEXT.nav.back}
          </button>
          <button type="button" class="button primary" onClick={onNext}>
            {t.next}
          </button>
        </div>
      </div>

      <BudgetPanel
        budgets={evaluation.budgets}
        issues={evaluation.issues}
        critical={scenario.criticalResources}
      />
    </section>
  );
}
