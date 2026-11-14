// Gen Worlds © 2026 Echo Yin. PolyForm Noncommercial 1.0.0: see LICENSE.md.
import { useMemo } from 'preact/hooks';
import { computePorkchop } from '@/astro/interplanetary';
import { isoDateFromJd, jdFromUnixMs } from '@/astro/time';
import { getBody } from '@/data/bodies';
import { capacityAt, getLaunchVehicle } from '@/data/launch-vehicles';
import { tierAllows } from '@/data/mission-constants';
import type { MissionDesign, TrajectoryChoice } from '@/mission/design';
import { type DesignEvaluation, evaluateDesign } from '@/mission/evaluate-design';
import { money, num, percent } from '@/mission/format';
import { lifetimeText } from '@/mission/orbit-budgets';
import { computeOrbitModel } from '@/mission/orbit-model';
import { type BudgetChange, previewChanges } from '@/mission/preview';
import { computeSiteCalendar } from '@/mission/site-calendar';
import { landingWindowJd } from '@/mission/validation';
import { artUrl } from '@/ui/art';
import { BudgetPanel } from '@/ui/budget-panel';
import { CapacityChart } from '@/ui/charts/capacity-chart';
import { PorkchopChart } from '@/ui/charts/porkchop-chart';
import { SkyCalendar } from '@/ui/charts/sky-calendar';
import { ChoiceCard, type ChoiceStat } from '@/ui/choice-card';
import { type CrewView, mayAct, ownedBy } from '@/ui/crew-view';
import { TEXT } from '@/ui/text';

export interface TrajectoryScreenProps {
  evaluation: DesignEvaluation;
  /** Null when playing alone. */
  crew: CrewView | null;
  onChange: (change: Partial<TrajectoryChoice>) => void;
  onNext: () => void;
  onBack: () => void;
}

const PORKCHOP_COLUMNS = 96;
const PORKCHOP_ROWS = 80;

/** How to get there and when: rocket, route, landing site and landing date, each with its effect. */
export function TrajectoryScreen({ evaluation, crew, onChange, onNext, onBack }: TrajectoryScreenProps) {
  const routeMine = mayAct(crew, 'comms');
  const siteMine = mayAct(crew, 'science');
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
      orbits: new Map(
        (scenario.orbit?.options ?? []).map((option) => [option.id, preview({ orbitId: option.id })]),
      ),
    }),
    [evaluation],
  );
  const { route, entry } = scenario;
  const porkchop = useMemo(
    () =>
      route
        ? computePorkchop({
            from: route.from,
            to: route.to,
            departureJdStart: jdFromUnixMs(Date.parse(route.departureWindow.startDate)),
            departureJdEnd: jdFromUnixMs(Date.parse(route.departureWindow.endDate)),
            columns: PORKCHOP_COLUMNS,
            arrivalJdStart: window.start,
            arrivalJdEnd: window.end,
            rows: PORKCHOP_ROWS,
          })
        : null,
    [route, window.start, window.end],
  );
  // The arrival speed at which the atmosphere is met at the heat shield's limit.
  const maxArrivalKmS = useMemo(() => {
    if (!entry) return null;
    const body = getBody(scenario.targetBody);
    const escapeSquared = (2 * body.mu) / (body.equatorialRadiusM + entry.interfaceAltitudeM);
    return Math.sqrt(Math.max(0, entry.maxEntrySpeedMS ** 2 - escapeSquared)) / 1000;
  }, [entry, scenario.targetBody]);
  const departureJd = design.trajectory.departureJd ?? null;
  const calendar = useMemo(
    () =>
      site && scenario.sky.model === 'lunar'
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
        <figure class="trajectory-stage">
          <img src={artUrl(scenario.stageArt, scenario.id)} alt={TEXT.flight.stageAlt} />
          <figcaption>
            <strong>{site?.name ?? resolved.orbit?.name ?? scenario.terms.destination}</strong>
            <span>{scenario.tagline}</span>
          </figcaption>
        </figure>
        <h2>{t.vehicle}</h2>
        {!routeMine && <p class="banner owned">{ownedBy(crew, 'comms')}</p>}
        <div class="split">
          <ul class="part-list">
            {vehicles.map((option, index) => {
              const stats: ChoiceStat[] = [
                { label: t.cost, value: money(option.costMusd) },
                { label: t.reliability, value: percent(option.reliability) },
              ];
              if (resolved.orbit) {
                stats.push({
                  label: t.liftsToOrbit,
                  value: `${num(capacityAt(option.ssoCapacity, resolved.orbit.altitudeKm))} kg`,
                });
              } else if (transfer) {
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
                    disabled={!routeMine}
                    onChoose={() => onChange({ launchVehicleId: option.id })}
                  />
                </li>
              );
            })}
          </ul>
          <CapacityChart
            vehicles={vehicles}
            selectedId={vehicle?.id ?? null}
            c3={scenario.orbit ? (resolved.orbit?.altitudeKm ?? null) : (transfer?.c3Km2S2 ?? null)}
            neededKg={neededKg}
            axis={scenario.orbit ? 'altitude' : 'energy'}
          />
        </div>

        {scenario.orbit && (
          <>
            <h2>{t.orbit}</h2>
            <ul class="part-list two">
              {scenario.orbit.options.map((option) => {
                // Each card shows what this orbit would mean for the satellite as designed.
                const model = computeOrbitModel({ ...resolved, orbit: option });
                return (
                  <li key={option.id}>
                    <ChoiceCard
                      title={option.name}
                      summary={option.summary}
                      stats={
                        model
                          ? [
                              {
                                label: t.eclipse,
                                value: `${percent(model.eclipseFraction)} ${t.perOrbit}`,
                              },
                              {
                                label: t.contact,
                                value: `${num(model.contactFraction * 1440, 0)} ${t.perDay}`,
                              },
                              { label: t.lifetime, value: lifetimeText(model.naturalLifetimeYears) },
                              {
                                label: t.detail,
                                value: `${num(500 / option.altitudeKm, 2)} ${t.detailUnit}`,
                              },
                            ]
                          : []
                      }
                      selected={resolved.orbit?.id === option.id}
                      changes={previews.orbits.get(option.id) ?? []}
                      disabled={!routeMine}
                      onChoose={() => onChange({ orbitId: option.id })}
                    />
                  </li>
                );
              })}
            </ul>
          </>
        )}
        {!scenario.orbit && (
          <h2>
            {t.transfer} {scenario.terms.destination}
          </h2>
        )}
        {porkchop && (
          <div class="date-picker">
            <PorkchopChart
              grid={porkchop}
              maxArrivalKmS={maxArrivalKmS}
              departureJd={departureJd}
              arrivalJd={landingJd}
              onPick={(departure, arrival) => {
                if (routeMine) onChange({ departureJd: departure, landingJd: arrival });
              }}
            />
            <div class="date-sliders">
              <label>
                {t.launchDate}
                <input
                  type="range"
                  disabled={!routeMine}
                  min={porkchop.departureJdStart}
                  max={porkchop.departureJdEnd}
                  step={1}
                  value={departureJd ?? porkchop.departureJdStart}
                  onInput={(event) => onChange({ departureJd: Number(event.currentTarget.value) })}
                />
              </label>
              <label>
                {t.arrivalDate}
                <input
                  type="range"
                  disabled={!routeMine}
                  min={window.start}
                  max={window.end}
                  step={1}
                  value={landingJd ?? window.start}
                  onInput={(event) => onChange({ landingJd: Number(event.currentTarget.value) })}
                />
              </label>
            </div>
            <p class="date-readout">
              {departureJd === null || landingJd === null ? (
                <span class="dim">{t.porkchopHint}</span>
              ) : !transfer ? (
                <span class="dim">{t.noTransfer}</span>
              ) : (
                <>
                  <strong>
                    {t.launch} {isoDateFromJd(departureJd)} → {t.landing.toLowerCase()}{' '}
                    {isoDateFromJd(landingJd)}
                  </strong>
                  <span class="dim">
                    {' '}
                    · {num(transfer.durationDays)} {t.days} · {t.energy} {num(transfer.c3Km2S2, 1)} km²/s²
                    {resolved.arrival &&
                      ` · ${t.entrySpeed} ${num(resolved.arrival.entrySpeedMS / 1000, 1)} km/s`}
                  </span>
                </>
              )}
            </p>
          </div>
        )}
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
                disabled={!routeMine}
                onChoose={() => onChange({ transferId: option.id })}
              />
            </li>
          ))}
        </ul>

        {!scenario.orbit && <h2>{t.site}</h2>}
        {!siteMine && <p class="banner owned">{ownedBy(crew, 'science')}</p>}
        <ul class="part-list three">
          {scenario.sites.map((option) => (
            <li key={option.id}>
              <ChoiceCard
                title={option.name}
                eyebrow={`${num(Math.abs(option.latitudeDeg), 2)}° ${option.latitudeDeg < 0 ? 'S' : 'N'}`}
                summary={option.summary}
                stats={[
                  { label: scenario.terms.qualityLabel, value: percent(option.iceQuality) },
                  {
                    label: scenario.terms.driveLabel,
                    value:
                      option.shadowDistanceKm > 0
                        ? `${num(option.shadowDistanceKm)} km`
                        : scenario.terms.atTarget,
                  },
                  { label: t.hazard, value: `× ${num(option.landingHazardFactor, 1)}` },
                  { label: t.slope, value: `${num(option.slopeDeg)}°` },
                ]}
                selected={site?.id === option.id}
                changes={previews.sites.get(option.id) ?? []}
                disabled={!siteMine}
                onChoose={() => onChange({ siteId: option.id })}
              />
            </li>
          ))}
        </ul>

        {!route && !scenario.orbit && <h2>{t.date}</h2>}
        {route || scenario.orbit ? null : calendar ? (
          <div class="date-picker">
            <SkyCalendar
              calendar={calendar}
              landingDay={landingDay}
              missionDays={scenario.surfaceDurationDays}
              windowDays={windowDays}
            >
              <input
                type="range"
                disabled={!routeMine}
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
