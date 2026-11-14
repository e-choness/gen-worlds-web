import type { Tier, TierId } from '@/data/mission-constants';
import type { Scenario } from '@/data/scenarios';
import { RESOURCE_NAMES, TEXT } from '@/ui/text';

export interface ScenarioScreenProps {
  scenarios: readonly Scenario[];
  tiers: readonly Tier[];
  tier: TierId;
  onTier: (tier: TierId) => void;
  onChoose: (scenarioId: string) => void;
  onBack: () => void;
}

/** Pick the difficulty, then the mission. */
export function ScenarioScreen({ scenarios, tiers, tier, onTier, onChoose, onBack }: ScenarioScreenProps) {
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
              <img class="card-art" src={import.meta.env.BASE_URL + scenario.art} alt="" loading="lazy" />
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

      <div class="actions">
        <button type="button" class="button" onClick={onBack}>
          {TEXT.nav.back}
        </button>
      </div>
    </section>
  );
}
