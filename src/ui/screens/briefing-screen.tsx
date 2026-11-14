// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0 or MIT: see LICENSE.md.
import type { Tier } from '@/data/mission-constants';
import type { Scenario } from '@/data/scenarios';
import { artUrl } from '@/ui/art';
import { RESOURCE_NAMES, TEXT } from '@/ui/text';

export interface BriefingScreenProps {
  scenario: Scenario;
  tier: Tier;
  onNext: () => void;
  onBack: () => void;
}

/** The mission as the team first hears it: the goal, what counts as success, and the limits. */
export function BriefingScreen({ scenario, tier, onNext, onBack }: BriefingScreenProps) {
  const cap = Math.round(scenario.budgetCapMusd * tier.budgetFactor);
  const t = TEXT.briefing;
  return (
    <section class="screen briefing">
      {/* Decorative: the heading names the destination. */}
      <img class="briefing-art" src={artUrl(scenario.art, scenario.id)} alt="" />
      <div class="eyebrow">
        {TEXT.scenarios.mission} {scenario.number} · {tier.name}
      </div>
      <h1>{scenario.name}</h1>
      <p class="lede">{scenario.briefing}</p>

      <div class="columns">
        <div>
          <h2>{t.objectives}</h2>
          <ol class="objective-list">
            {scenario.objectives.map((objective) => (
              <li key={objective.id}>
                <span class="objective-weight" title={t.weightTitle}>
                  {Math.round(objective.weight * 100)}%
                </span>
                <span>
                  <strong>{objective.name}</strong>
                  <span class="card-text">{objective.summary}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>

        <div>
          <h2>{t.constraints}</h2>
          <dl class="facts">
            <dt>{t.budget}</dt>
            <dd>
              ${cap}M <span class="dim">{t.budgetNote}</span>
            </dd>
            <dt>{scenario.orbit ? t.orbitDuration : t.duration}</dt>
            <dd>
              {scenario.surfaceDurationDays} {t.days}
            </dd>
            {!scenario.orbit && (
              <>
                <dt>{t.window}</dt>
                <dd>
                  {scenario.landingWindow.startDate} → {scenario.landingWindow.endDate}
                </dd>
              </>
            )}
            <dt>{t.critical}</dt>
            <dd class="chips">
              {scenario.criticalResources.map((resource) => (
                <span key={resource} class="chip">
                  {RESOURCE_NAMES[resource]}
                </span>
              ))}
            </dd>
            <dt>{scenario.orbit ? t.orbits : t.sites}</dt>
            <dd>
              {(scenario.orbit ? scenario.orbit.options : scenario.sites)
                .map((option) => option.name)
                .join(' · ')}
            </dd>
          </dl>

          <aside class="reference-card">
            <h3>{t.nasa}</h3>
            <p>
              <strong>{scenario.nasaReference.mission}.</strong> {scenario.nasaReference.summary}
            </p>
            <a href={scenario.nasaReference.url} target="_blank" rel="noreferrer">
              {t.readMore}
            </a>
          </aside>
        </div>
      </div>

      <div class="actions">
        <button type="button" class="button" onClick={onBack}>
          {TEXT.nav.back}
        </button>
        <button type="button" class="button primary" data-autofocus onClick={onNext}>
          {t.next}
        </button>
      </div>
    </section>
  );
}
