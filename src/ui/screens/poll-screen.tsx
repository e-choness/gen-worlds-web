import type { RoleId } from '@/data/mission-constants';
import type { DesignEvaluation } from '@/mission/evaluate-design';
import { num, percent } from '@/mission/format';
import type { MonteCarloSummary } from '@/mission/monte-carlo';
import { type PollVotes, pollOutcome, type RoleVote, roleReadiness } from '@/mission/poll';
import { ScoreHistogram } from '@/ui/charts/score-histogram';
import { type CrewView, mayAct, roleWithHolder } from '@/ui/crew-view';
import { StatusBadge } from '@/ui/status-badge';
import { TEXT } from '@/ui/text';

/** The forecast as the screen sees it (mirrors the store's state without importing the app layer). */
export type ForecastView =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'done'; summary: MonteCarloSummary }
  | { status: 'failed'; error: string };

export interface PollScreenProps {
  evaluation: DesignEvaluation;
  votes: PollVotes;
  forecast: ForecastView;
  /** Null when playing alone. */
  crew: CrewView | null;
  /** Set when the next launch flies a fixed seed (a shared link or the daily mission). */
  challenge: { seed: number; daily: string | null } | null;
  onClearChallenge: () => void;
  onVote: (role: RoleId, vote: Partial<RoleVote>) => void;
  onAllGo: () => void;
  onForecast: () => void;
  onLaunch: () => void;
  onBack: () => void;
}

function Forecast({
  forecast,
  onForecast,
  enabled,
}: {
  forecast: ForecastView;
  onForecast: () => void;
  enabled: boolean;
}) {
  const t = TEXT.poll;
  return (
    <section class="forecast" aria-live="polite">
      <h2>{t.forecast}</h2>
      <p class="hint">{t.forecastHint}</p>
      {forecast.status !== 'done' && (
        <button
          type="button"
          class="button"
          disabled={!enabled || forecast.status === 'running'}
          onClick={onForecast}
        >
          {forecast.status === 'running' ? t.forecastRunning : t.forecastRun}
        </button>
      )}
      {forecast.status === 'failed' && <p class="banner">{forecast.error}</p>}
      {forecast.status === 'done' && (
        <>
          <dl class="forecast-shares">
            <div data-status="ok">
              <dt>{t.success}</dt>
              <dd>{percent(forecast.summary.successShare)}</dd>
            </div>
            <div data-status="warning">
              <dt>{t.partial}</dt>
              <dd>{percent(forecast.summary.partialShare)}</dd>
            </div>
            <div data-status="fail">
              <dt>{t.failure}</dt>
              <dd>{percent(forecast.summary.failureShare)}</dd>
            </div>
          </dl>
          <ScoreHistogram scores={forecast.summary.scores} />
          <p class="forecast-scores">
            {t.typicalScore} <strong>{num(forecast.summary.scoreP50, 0)}</strong>{' '}
            <span class="dim">
              ({t.range} {num(forecast.summary.scoreP10, 0)}–{num(forecast.summary.scoreP90, 0)})
            </span>
          </p>
          {forecast.summary.commonProblems.length > 0 && (
            <>
              <h3>{t.problems}</h3>
              <ul class="problem-list">
                {forecast.summary.commonProblems.map((problem) => (
                  <li key={problem.title}>
                    <span>{problem.title}</span>
                    <span class="dim">{percent(problem.share)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}

/** Each role reviews what it answers for and votes; the forecast shows what the dice may do. */
export function PollScreen(props: PollScreenProps) {
  const { evaluation, votes, crew } = props;
  const outcome = pollOutcome(votes, evaluation);
  const t = TEXT.poll;
  return (
    <section class="screen wide poll">
      <div>
        <h1>{t.heading}</h1>
        <p class="lede">{t.summary}</p>
        {props.challenge && (
          <p class="banner challenge" role="status">
            {props.challenge.daily ? t.dailyChallenge : t.challenge} {props.challenge.seed}
            {t.challengeEnd}{' '}
            <button type="button" class="link" onClick={props.onClearChallenge}>
              {t.freshLuck}
            </button>
          </p>
        )}
        <ul class="role-grid">
          {roleReadiness(evaluation).map(({ role, status, lines, issues }, index) => {
            const vote = votes[role.id];
            return (
              <li key={role.id} class="card role-card" data-role={role.id}>
                <div class="part-head">
                  <span class="card-title">{roleWithHolder(crew, role.id)}</span>
                  <StatusBadge status={status} />
                </div>
                <span class="card-text">{role.summary}</span>
                <ul class="role-lines">
                  {lines.map((line) => (
                    <li key={line.id}>
                      <StatusBadge status={line.status} compact />
                      <span>
                        <strong>{line.label}.</strong> {line.why}
                      </span>
                    </li>
                  ))}
                  {issues.map((issue) => (
                    <li key={issue.code + issue.message}>
                      <StatusBadge status={issue.severity === 'error' ? 'fail' : 'warning'} compact />
                      <span>{issue.message}</span>
                    </li>
                  ))}
                  {lines.length + issues.length === 0 && (
                    <li>
                      <StatusBadge status="ok" compact />
                      <span>{t.nothingOpen}</span>
                    </li>
                  )}
                </ul>
                <fieldset class="vote-row">
                  <legend class="visually-hidden">
                    {role.name}: {t.vote}
                  </legend>
                  <button
                    type="button"
                    class={vote.vote === 'go' ? 'button small vote go selected' : 'button small vote go'}
                    aria-pressed={vote.vote === 'go'}
                    data-autofocus={index === 0 ? true : undefined}
                    disabled={!mayAct(crew, role.id)}
                    onClick={() => props.onVote(role.id, { vote: 'go' })}
                  >
                    {t.go}
                  </button>
                  <button
                    type="button"
                    class={
                      vote.vote === 'no_go' ? 'button small vote no-go selected' : 'button small vote no-go'
                    }
                    aria-pressed={vote.vote === 'no_go'}
                    disabled={!mayAct(crew, role.id)}
                    onClick={() => props.onVote(role.id, { vote: 'no_go' })}
                  >
                    {t.noGo}
                  </button>
                </fieldset>
                {vote.vote === 'no_go' && (
                  <label class="reason">
                    <span>{t.reason}</span>
                    <input
                      type="text"
                      value={vote.reason}
                      placeholder={t.reasonPlaceholder}
                      disabled={!mayAct(crew, role.id)}
                      onInput={(event) => props.onVote(role.id, { reason: event.currentTarget.value })}
                    />
                  </label>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <aside class="poll-side">
        <Forecast forecast={props.forecast} onForecast={props.onForecast} enabled={evaluation.launchable} />
        <section class="launch-box">
          <h2>{t.decision}</h2>
          <p class={outcome.canLaunch ? 'poll-why go' : 'poll-why'} role="status">
            {outcome.why}
          </p>
          <div class="actions column">
            <button
              type="button"
              class="button small"
              disabled={!evaluation.launchable}
              onClick={props.onAllGo}
            >
              {crew ? t.myGo : t.allGo}
            </button>
            <button
              type="button"
              class="button primary launch"
              disabled={!outcome.canLaunch || !mayAct(crew, 'director')}
              onClick={props.onLaunch}
            >
              {t.launch}
            </button>
            {!mayAct(crew, 'director') && (
              <p class="hint">
                {t.directorLaunches} {roleWithHolder(crew, 'director')}
              </p>
            )}
            <button type="button" class="button small" onClick={props.onBack}>
              {TEXT.nav.back}
            </button>
          </div>
        </section>
      </aside>
    </section>
  );
}
