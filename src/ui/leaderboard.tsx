// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
import { useState } from 'preact/hooks';
import { num } from '@/mission/format';
import { TEXT } from '@/ui/text';

export interface BoardLine {
  name: string;
  score: number;
  /** ISO date of the daily mission the flight belonged to, or null. */
  daily: string | null;
}

export interface LeaderboardProps {
  /** Best first, already limited to this scenario. */
  lines: readonly BoardLine[];
  /** `global`: checked entries from every player. `local`: this device's own runs. */
  scope: 'global' | 'local';
  status: 'idle' | 'loading' | 'done' | 'failed';
  error: string | null;
  /** Score of the run being debriefed, to mark where it would stand. */
  score: number;
  defaultName: string;
  /** Null when this run cannot be submitted (no online board). */
  onSubmit: ((name: string) => void) | null;
  submitted: boolean;
  /** Copies a link to this exact flight; null before a flight exists. */
  link: string | null;
}

const SHOWN = 10;

/** Where this flight stands, the form to enter it, and the link that lets anyone fly it again. */
export function Leaderboard(props: LeaderboardProps) {
  const t = TEXT.board;
  const [name, setName] = useState(props.defaultName);
  const [copied, setCopied] = useState(false);
  const rank = props.lines.filter((line) => line.score > props.score).length + 1;

  const copy = (): void => {
    if (!props.link) return;
    navigator.clipboard.writeText(props.link).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };

  return (
    <section class="leaderboard">
      <h2>{props.scope === 'global' ? t.global : t.local}</h2>
      <p class="hint">{props.scope === 'global' ? t.globalHint : t.localHint}</p>
      {props.status === 'loading' && <p class="dim">{t.loading}</p>}
      {props.status === 'failed' && <p class="banner">{props.error}</p>}
      {props.lines.length > 0 && (
        <ol class="board-list">
          {props.lines.slice(0, SHOWN).map((line, index) => (
            <li key={`${line.name}-${line.score}-${index}`}>
              <span class="board-rank">{index + 1}</span>
              <span class="board-name">
                {line.name}
                {line.daily && <span class="chip">{t.daily}</span>}
              </span>
              <span class="board-score">{num(line.score, 0)}</span>
            </li>
          ))}
        </ol>
      )}
      {props.status === 'done' && props.lines.length === 0 && <p class="dim">{t.empty}</p>}
      <p class="board-rankline">
        {t.thisFlight} <strong>{num(props.score, 0)}</strong> {t.points} · {t.wouldRank} {rank}
      </p>
      <div class="board-actions">
        {props.onSubmit && !props.submitted && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              props.onSubmit?.(name);
            }}
          >
            <label>
              {t.name}
              <input
                type="text"
                value={name}
                maxLength={20}
                onInput={(event) => setName(event.currentTarget.value)}
              />
            </label>
            <button type="submit" class="button small" disabled={!name.trim()}>
              {t.submit}
            </button>
          </form>
        )}
        {props.submitted && <p class="dim">{t.submitted}</p>}
        {props.link && (
          <button type="button" class="button small" onClick={copy}>
            {copied ? t.copied : t.copy}
          </button>
        )}
      </div>
      <p class="hint">{t.linkHint}</p>
    </section>
  );
}
