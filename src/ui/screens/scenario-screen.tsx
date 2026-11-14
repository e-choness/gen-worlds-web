// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0 or MIT: see LICENSE.md.
import type { Tier, TierId } from '@/data/mission-constants';
import type { Scenario } from '@/data/scenarios';
import { artUrl } from '@/ui/art';
import { RESOURCE_NAMES, TEXT } from '@/ui/text';

export interface ScenarioScreenProps {
  scenarios: readonly Scenario[];
  tiers: readonly Tier[];
  tier: TierId;
  onTier: (tier: TierId) => void;
  onChoose: (scenarioId: string) => void;
  /** A generated world of the galaxy offered as a mission. */
  world: Scenario;
  onAnotherWorld: () => void;
  /** Opens the galaxy map to pick a world. */
  onExplore: () => void;
  onBack: () => void;
}

/** Pick the difficulty, then the mission. */
export function ScenarioScreen({
  scenarios,
  tiers,
  tier,
  onTier,
  onChoose,
  world,
  onAnotherWorld,
  onExplore,
  onBack,
}: ScenarioScreenProps) {
  const current = tiers.find((candidate) => candidate.id === tier);
  return (
    <section class="screen">
      <h1>{TEXT.scenarios.heading}</h1>
      <p class="lede">{TEXT.scenarios.summary}</p>

      <fieldset class="segmented">
        <legend>{TEXT.scenarios.tier}</legend>
        {tiers.map((option) => (
          <label key={option.id} class={option.id === tier ? 'selected' : ''}>
            <input
              type="radio"
              name="tier"
              value={option.id}
              checked={option.id === tier}
              onChange={() => onTier(option.id)}
            />
            {option.name}
          </label>
        ))}
      </fieldset>
      {current && <p class="hint">{current.summary}</p>}

      <ul class="card-grid">
        {scenarios.map((scenario, index) => (
          <li key={scenario.id}>
            <button
              type="button"
              class="card scenario-card"
              data-autofocus={index === 0 ? true : undefined}
              onClick={() => onChoose(scenario.id)}
            >
              {/* Decorative: the card title names the destination. */}
              <img class="card-art" src={artUrl(scenario.art, scenario.id)} alt="" loading="lazy" />
              <span class="eyebrow">
                {TEXT.scenarios.mission} {scenario.number}
              </span>
              <span class="card-title">{scenario.name}</span>
              <span class="card-text">{scenario.tagline}</span>
              <span class="chips">
                <span class="chip-label">{TEXT.scenarios.critical}</span>
                {scenario.criticalResources.map((resource) => (
                  <span key={resource} class="chip">
                    {RESOURCE_NAMES[resource]}
                  </span>
                ))}
              </span>
              <span class="card-action">{TEXT.scenarios.next}</span>
            </button>
          </li>
        ))}
      </ul>

      <h2>{TEXT.scenarios.galaxy}</h2>
      <div class="card world-card">
        <img class="world-art" src={artUrl(world.art, world.id)} alt="" />
        <div class="world-body">
          <span class="eyebrow">{TEXT.scenarios.galaxyEyebrow}</span>
          <span class="card-title">{world.name}</span>
          <p class="card-text">{world.briefing}</p>
          <div class="actions">
            <button type="button" class="button primary" onClick={() => onChoose(world.id)}>
              {TEXT.scenarios.next}
            </button>
            <button type="button" class="button" onClick={onAnotherWorld}>
              {TEXT.scenarios.anotherWorld}
            </button>
            <button type="button" class="button" onClick={onExplore}>
              {TEXT.scenarios.explore}
            </button>
          </div>
          <p class="hint">{TEXT.scenarios.exploreHint}</p>
        </div>
      </div>

      <div class="actions">
        <button type="button" class="button" onClick={onBack}>
          {TEXT.nav.back}
        </button>
      </div>
    </section>
  );
}
