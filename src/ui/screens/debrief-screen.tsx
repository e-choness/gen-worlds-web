// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0 or MIT: see LICENSE.md.
import type { PartCategory } from '@/data/parts';
import type { Scenario } from '@/data/scenarios';
import type { MissionDesign } from '@/mission/design';
import { describeDesignChanges } from '@/mission/design-diff';
import { num, percent } from '@/mission/format';
import type { MissionOutcome } from '@/mission/scoring';
import type { MissionResult } from '@/mission/simulate-mission';
import { SLOT_NAMES } from '@/mission/slot-names';
import { artUrl } from '@/ui/art';
import { Leaderboard, type LeaderboardProps } from '@/ui/leaderboard';
import { StatusBadge } from '@/ui/status-badge';
import { SystemIcon } from '@/ui/system-icon';
import { TEXT } from '@/ui/text';

/** A past run as the debrief needs it (mirrors the store's record without importing the app layer). */
export interface RunSummary {
  id: number;
  seed: number;
  design: MissionDesign;
  score: number;
  outcome: MissionOutcome;
}

export interface DebriefScreenProps {
  result: MissionResult;
  scenario: Scenario;
  /** Newest first; the first entry is the run being debriefed. */
  history: readonly RunSummary[];
  board: LeaderboardProps;
  /** Opens the screen where the given part of the design is decided. */
  onRevise: (target: 'design' | 'trajectory') => void;
  onFlyAgain: () => void;
  onNewMission: () => void;
}

/** Circumference of the score ring (radius 74): the ring fills with the share of the science achieved. */
const RING_LENGTH = 2 * Math.PI * 74;

const OUTCOME_STATUS = { success: 'ok', partial: 'warning', failure: 'fail' } as const;

function slotLabel(slot: PartCategory | 'trajectory' | null): string | null {
  if (!slot) return null;
  return slot === 'trajectory' ? TEXT.debrief.trajectory : SLOT_NAMES[slot];
}

/** What happened and why, traced back to the design, with the way to change it and try again. */
export function DebriefScreen({
  result,
  scenario,
  history,
  board,
  onRevise,
  onFlyAgain,
  onNewMission,
}: DebriefScreenProps) {
  const t = TEXT.debrief;
  const { score } = result;
  const rows: { label: string; value: number; sign?: string }[] = [
    { label: t.science, value: score.science },
    { label: t.efficiency, value: score.efficiency },
    { label: t.margins, value: score.margins },
    { label: t.survival, value: score.survival },
  ];
  if (score.coordination > 0) rows.push({ label: t.coordination, value: score.coordination });
  if (score.dataLossPenalty > 0) rows.push({ label: t.dataLoss, value: -score.dataLossPenalty });

  return (
    <section class="screen debrief">
      <div class="debrief-head" data-outcome={score.outcome}>
        {/* Decorative: where the mission flew. */}
        <img class="debrief-art" src={artUrl(scenario.stageArt, scenario.id)} alt="" />
        <div class="score-ring" role="img" aria-label={`${num(score.total, 0)} ${t.points}`}>
          <svg aria-hidden="true" viewBox="0 0 168 168" fill="none">
            <circle class="ring-track" cx="84" cy="84" r="74" stroke-width="12" />
            <circle
              class="ring-fill"
              cx="84"
              cy="84"
              r="74"
              stroke-width="12"
              stroke-dasharray={`${RING_LENGTH * score.scienceFraction} ${RING_LENGTH}`}
              transform="rotate(-90 84 84)"
            />
          </svg>
          <span class="score-value">{num(score.total, 0)}</span>
          <span class="dim">{t.points}</span>
        </div>
        <div class="debrief-summary">
          <div class="outcome">
            <StatusBadge status={OUTCOME_STATUS[score.outcome]} compact />
            {t.outcomes[score.outcome]}
          </div>
          <h1>{result.headline}</h1>
        </div>
      </div>

      <div class="columns">
        <div>
          <h2>{t.findings}</h2>
          {result.findings.length === 0 && <p class="hint">{t.noFindings}</p>}
          <ul class="finding-list">
            {result.findings.map((finding) => {
              const label = slotLabel(finding.slot);
              return (
                <li key={finding.title + finding.detail} data-tone={finding.tone}>
                  <StatusBadge status={finding.tone === 'good' ? 'ok' : 'fail'} compact />
                  {finding.slot && <SystemIcon system={finding.slot} size={30} />}
                  <div>
                    <strong>{finding.title}</strong>
                    <p>{finding.detail}</p>
                    {label && finding.tone === 'bad' && (
                      <button
                        type="button"
                        class="link-button"
                        onClick={() => onRevise(finding.slot === 'trajectory' ? 'trajectory' : 'design')}
                      >
                        {t.revisit} {label.toLowerCase()}
                      </button>
                    )}
                    {label && finding.tone === 'good' && <span class="credit">{label}</span>}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <div>
          <h2>{t.objectives}</h2>
          <ul class="objective-results">
            {result.objectives.map((entry) => (
              <li key={entry.objective.id}>
                <div class="budget-head">
                  <span class="budget-name">{entry.objective.name}</span>
                  <span class="budget-amount">{percent(entry.achieved)}</span>
                </div>
                <div class="budget-bar" aria-hidden="true">
                  <div style={{ width: `${entry.achieved * 100}%` }} />
                </div>
                <p class="budget-why">{entry.why}</p>
              </li>
            ))}
          </ul>

          <h2>{t.score}</h2>
          <table class="score-table">
            <tbody>
              {rows.map((row) => (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  <td>{num(row.value, 0)}</td>
                </tr>
              ))}
              {score.tierFactor !== 1 && (
                <tr>
                  <th scope="row">{t.tierFactor}</th>
                  <td>× {num(score.tierFactor, 2)}</td>
                </tr>
              )}
              <tr class="total">
                <th scope="row">{t.total}</th>
                <td>{num(score.total, 0)}</td>
              </tr>
            </tbody>
          </table>
          <p class="hint">
            {t.seed} {result.seed}
          </p>
        </div>
      </div>

      {history.length > 1 && (
        <>
          <h2>{t.runs}</h2>
          <table class="run-table">
            <thead>
              <tr>
                <th scope="col">{t.run}</th>
                <th scope="col">{t.result}</th>
                <th scope="col">{t.points}</th>
                <th scope="col">{t.changed}</th>
              </tr>
            </thead>
            <tbody>
              {history.slice(0, 6).map((run, index) => {
                const previous = history[index + 1];
                const changes = previous ? describeDesignChanges(previous.design, run.design) : [];
                const delta = previous ? run.score - previous.score : null;
                return (
                  <tr key={run.id} class={index === 0 ? 'current' : undefined}>
                    <td>{run.id}</td>
                    <td>
                      <StatusBadge status={OUTCOME_STATUS[run.outcome]} compact /> {t.outcomes[run.outcome]}
                    </td>
                    <td>
                      {num(run.score, 0)}
                      {delta !== null && delta !== 0 && (
                        <span class={delta > 0 ? 'delta up' : 'delta down'}>
                          {' '}
                          {delta > 0 ? '+' : '−'}
                          {num(Math.abs(delta), 0)}
                        </span>
                      )}
                    </td>
                    <td>
                      {!previous ? t.firstRun : changes.length === 0 ? t.sameDesign : changes.join(' · ')}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}

      <Leaderboard {...board} />

      <details class="timeline-details">
        <summary>{t.timeline}</summary>
        <ol class="mission-log">
          {result.timeline.map((entry) => (
            <li key={`${entry.day}-${entry.title}`} data-tone={entry.tone}>
              <span class="log-day">
                {entry.day < 0
                  ? TEXT.flight.before
                  : `${TEXT.flight.day} ${num(entry.day, entry.day < 10 ? 1 : 0)}`}
              </span>
              <span class="log-icon" aria-hidden="true">
                {entry.tone === 'good' ? '✓' : entry.tone === 'bad' ? '✕' : '•'}
              </span>
              <span>
                <strong>{entry.title}.</strong> {entry.detail}
              </span>
            </li>
          ))}
        </ol>
      </details>

      <aside class="reference-card">
        <h3>{TEXT.briefing.nasa}</h3>
        <p>
          <strong>{scenario.nasaReference.mission}.</strong> {scenario.nasaReference.summary}
        </p>
        <a href={scenario.nasaReference.url} target="_blank" rel="noreferrer">
          {TEXT.briefing.readMore}
        </a>
      </aside>

      <div class="actions">
        <button type="button" class="button primary" data-autofocus onClick={() => onRevise('design')}>
          {t.revise}
        </button>
        <button type="button" class="button" onClick={onFlyAgain}>
          {t.flyAgain}
        </button>
        <button type="button" class="button" onClick={onNewMission}>
          {t.newMission}
        </button>
      </div>
    </section>
  );
}
