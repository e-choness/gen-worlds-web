import { useEffect, useState } from 'preact/hooks';
import { num } from '@/mission/format';
import type { MissionResult } from '@/mission/simulate-mission';
import type { TimelineEntry } from '@/mission/timeline';
import { TEXT } from '@/ui/text';

export interface FlightScreenProps {
  result: MissionResult;
  /** Shown when the 3D flight is not available on this device. */
  notice: string | null;
  onDebrief: () => void;
}

const STEP_MS = 650;
const TONE_ICONS: Record<TimelineEntry['tone'], string> = { good: '✓', bad: '✕', neutral: '•' };

function prefersReducedMotion(): boolean {
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * The fast simulation as a mission log that plays back event by event. The result is already
 * decided by the simulation; this screen only reveals it, and can be skipped.
 */
export function FlightScreen({ result, notice, onDebrief }: FlightScreenProps) {
  const total = result.timeline.length;
  const [shown, setShown] = useState(() => (prefersReducedMotion() ? total : 0));
  const done = shown >= total;
  const t = TEXT.flight;

  useEffect(() => {
    if (done) return;
    const timer = setTimeout(() => setShown((count) => count + 1), STEP_MS);
    return () => clearTimeout(timer);
  }, [done]);

  return (
    <section class="screen flight">
      <h1>{t.heading}</h1>
      {notice && (
        <p class="banner" role="status">
          {notice}
        </p>
      )}
      <ol class="mission-log" aria-live="polite">
        {result.timeline.slice(0, shown).map((entry) => (
          <li key={`${entry.day}-${entry.title}`} data-tone={entry.tone}>
            <span class="log-day">
              {entry.day < 0 ? t.before : `${t.day} ${num(entry.day, entry.day < 10 ? 1 : 0)}`}
            </span>
            <span class="log-icon" aria-hidden="true">
              {TONE_ICONS[entry.tone]}
            </span>
            <span>
              <strong>{entry.title}.</strong> {entry.detail}
            </span>
          </li>
        ))}
      </ol>
      {done && (
        <p class="flight-headline" role="status">
          {result.headline}
        </p>
      )}
      <div class="actions">
        {!done && (
          <button type="button" class="button" onClick={() => setShown(total)}>
            {t.skip}
          </button>
        )}
        <button type="button" class="button primary" data-autofocus onClick={onDebrief}>
          {t.debrief}
        </button>
      </div>
    </section>
  );
}
