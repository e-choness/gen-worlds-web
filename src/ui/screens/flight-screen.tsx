// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { MISSION_CONSTANTS } from '@/data/mission-constants';
import { num } from '@/mission/format';
import { routedRole } from '@/mission/roles';
import type { MissionResult } from '@/mission/simulate-mission';
import type { TimelineEntry } from '@/mission/timeline';
import { MissionDashboard } from '@/ui/charts/mission-dashboard';
import { type CrewView, mayAct, roleWithHolder } from '@/ui/crew-view';
import { prefersReducedMotion } from '@/ui/dom';
import { FlightTheatre } from '@/ui/flight-theatre';
import { TEXT } from '@/ui/text';
import { COAST_SECONDS, theatrePhase, theatreSetup } from '@/ui/theatre-setup';

export interface FlightScreenProps {
  result: MissionResult;
  /** Shown when the 3D flight is not available on this device. */
  notice: string | null;
  /** Set when several people fly together: events then wait for their role to acknowledge them. */
  crew: CrewView | null;
  /** Seconds each routed event took to be acknowledged, keyed by timeline index. */
  responses: Readonly<Record<string, number>>;
  onAcknowledge: (key: string, seconds: number) => void;
  onDebrief: () => void;
  /** URL of the picture of where the mission works: shown where the 3D scene cannot run. */
  stageArt: string;
  /** True where WebGPU can draw the flight in 3D. */
  theatre: boolean;
  /** Reports what the log just revealed, for whoever turns it into sound. */
  onCue?: (cue: TimelineEntry['tone'] | 'alert') => void;
}

const STEP_MS = 650;
/** With the 3D scene playing, each line stays long enough to be read against it… */
const SCENE_STEP_MS = 1100;
/** …and the first line of a phase holds while its scene (lift-off, landing burn) plays out. */
const SCENE_OPENING_MS = 5200;
const TONE_ICONS: Record<TimelineEntry['tone'], string> = { good: '✓', bad: '✕', neutral: '•' };

/**
 * The fast simulation as a mission log that plays back event by event. The result is already
 * decided by the simulation; this screen only reveals it. Alone it can be skipped; with a crew it
 * stops at every event until the role responsible has acknowledged it.
 */
export function FlightScreen({
  result,
  notice,
  crew,
  responses,
  onAcknowledge,
  onDebrief,
  stageArt,
  theatre,
  onCue,
}: FlightScreenProps) {
  const total = result.timeline.length;
  const [shown, setShown] = useState(() => (prefersReducedMotion() && !crew ? total : 0));
  const [waited, setWaited] = useState(0);
  const revealedAt = useRef(performance.now());
  const done = shown >= total;
  const [sceneFailed, setSceneFailed] = useState(false);
  const scene = theatre && !sceneFailed;
  const setup = useMemo(() => theatreSetup(result.flownDesign), [result]);
  const t = TEXT.flight;
  const landingDay = result.timeline.find((entry) => entry.phase === 'landing')?.day ?? 0;
  // The dashboard follows the log: it has played up to the next entry still to be revealed.
  const playheadDay = done ? null : (result.timeline[shown]?.day ?? null);

  // The entry just revealed may need its role to answer before the log moves on.
  const lastIndex = shown - 1;
  const last = result.timeline[lastIndex];
  const waitingRole = crew && last && responses[String(lastIndex)] === undefined ? routedRole(last) : null;
  const limit = MISSION_CONSTANTS.scoring.coordinationResponseSeconds;

  // How long the line just revealed stays before the next one.
  const opensPhase =
    !!last && last.phase !== 'development' && result.timeline[lastIndex - 1]?.phase !== last.phase;
  // A landing that follows the launch directly is preceded by a short coast in the 3D scene.
  const coastMs =
    last?.phase === 'landing' && setup.leavesEarth && result.timeline[lastIndex - 1]?.phase === 'launch'
      ? COAST_SECONDS * 1000
      : 0;
  const stepMs =
    !scene || prefersReducedMotion() ? STEP_MS : opensPhase ? SCENE_OPENING_MS + coastMs : SCENE_STEP_MS;

  useEffect(() => {
    if (done || waitingRole) return;
    const timer = setTimeout(() => {
      revealedAt.current = performance.now();
      setWaited(0);
      const entry = result.timeline[shown];
      if (entry) onCue?.(crew && routedRole(entry) ? 'alert' : entry.tone);
      setShown(shown + 1);
    }, stepMs);
    return () => clearTimeout(timer);
  }, [done, waitingRole, shown, stepMs]);

  useEffect(() => {
    if (!waitingRole) return;
    const timer = setInterval(() => setWaited((performance.now() - revealedAt.current) / 1000), 1000);
    return () => clearInterval(timer);
  }, [waitingRole]);

  // The rail shows the phases this flight has, in order, and how far the log has come.
  const phases = [...new Set(result.timeline.map((entry) => entry.phase))].filter(
    (phase) => phase !== 'development',
  );
  const reached = new Set(result.timeline.slice(0, shown).map((entry) => entry.phase));
  const currentPhase = last && last.phase !== 'development' ? last.phase : null;

  const acknowledge = (): void => {
    onAcknowledge(String(lastIndex), (performance.now() - revealedAt.current) / 1000);
  };

  return (
    <section class="screen wide flight">
      <h1>{t.heading}</h1>
      {notice && (
        <p class="banner" role="status">
          {notice}
        </p>
      )}
      <div class="flight-layout">
        <aside class="flight-log" aria-label={t.log}>
          <h2>{t.log}</h2>
          <ol class="mission-log" aria-live="polite">
            {result.timeline.slice(0, shown).map((entry, index) => {
              const role = crew ? routedRole(entry) : null;
              const seconds = responses[String(index)];
              return (
                <li key={`${entry.day}-${entry.title}`} data-tone={entry.tone}>
                  <span class="log-day">
                    {entry.day < 0 ? t.before : `${t.day} ${num(entry.day, entry.day < 10 ? 1 : 0)}`}
                  </span>
                  <span class="log-icon" aria-hidden="true">
                    {TONE_ICONS[entry.tone]}
                  </span>
                  <span>
                    <strong>{entry.title}.</strong> {entry.detail}
                    {role && seconds !== undefined && (
                      <span class="log-ack">
                        {' '}
                        {roleWithHolder(crew, role)} {t.answeredIn} {num(seconds, 0)} s
                        {seconds > limit ? ` ${t.late}` : ''}.
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
        </aside>
        <div class="flight-main">
          <ol class="phase-rail" aria-label={t.heading}>
            {phases.map((phase) => (
              <li
                key={phase}
                data-state={phase === currentPhase ? 'now' : reached.has(phase) ? 'done' : 'next'}
                aria-current={phase === currentPhase ? 'step' : undefined}
              >
                {t.phases[phase]}
              </li>
            ))}
          </ol>
          <div class="flight-stage">
            {scene ? (
              <FlightTheatre
                setup={setup}
                phase={theatrePhase(last?.phase ?? null)}
                lost={done && result.lostIn !== null}
                label={`${t.sceneLabel} ${t.scenes[theatrePhase(last?.phase ?? null)]}`}
                fallbackArt={stageArt}
                fallbackAlt={t.stageAlt}
                onUnavailable={() => setSceneFailed(true)}
              />
            ) : (
              <img src={stageArt} alt={t.stageAlt} />
            )}
            <div class="stage-event" data-tone={last?.tone ?? 'neutral'}>
              {last ? (
                <>
                  <span class="log-day">
                    {last.day < 0 ? t.before : `${t.day} ${num(last.day, last.day < 10 ? 1 : 0)}`}
                  </span>
                  <strong>
                    <span aria-hidden="true">{TONE_ICONS[last.tone]} </span>
                    {last.title}
                  </strong>
                  <p>{last.detail}</p>
                </>
              ) : (
                <p>{t.standingBy}</p>
              )}
            </div>
          </div>
          {waitingRole && (
            <div class="ack-prompt" role="alert" data-role={waitingRole}>
              <p>
                <strong>{roleWithHolder(crew, waitingRole)}</strong>: {t.ackPrompt}{' '}
                <span class="dim">
                  {num(waited, 0)} s · {t.ackLimit} {limit} s
                </span>
              </p>
              <button
                type="button"
                class="button primary"
                // After the limit anyone may move the mission on: the answer already counts as late.
                disabled={!mayAct(crew, waitingRole) && waited < limit}
                onClick={acknowledge}
              >
                {mayAct(crew, waitingRole) ? t.acknowledge : t.moveOn}
              </button>
            </div>
          )}
          {result.surface && (done || (playheadDay !== null && playheadDay > landingDay)) && (
            <MissionDashboard
              telemetry={result.surface.telemetry}
              landingDay={landingDay}
              playheadDay={playheadDay}
            />
          )}
          {done && (
            <p class="flight-headline" role="status">
              {result.headline}
            </p>
          )}
          <div class="actions">
            {!done && !crew && (
              <button type="button" class="button" onClick={() => setShown(total)}>
                {t.skip}
              </button>
            )}
            <button
              type="button"
              class="button primary"
              data-autofocus
              // A crew answers every event first: the answers are part of the score the debrief shows.
              disabled={!!crew && !done}
              onClick={onDebrief}
            >
              {t.debrief}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
