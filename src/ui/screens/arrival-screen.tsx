import type { DescentPlan } from '@/mission/descent-plan';
import { num } from '@/mission/format';
import type { TimelineEntry } from '@/mission/timeline';
import { TEXT } from '@/ui/text';

export interface ArrivalScreenProps {
  /** What has happened up to arrival (development, launch, cruise). */
  timeline: readonly TimelineEntry[];
  plan: DescentPlan;
  /** False when the device cannot run the 3D flight: only the automatic landing is offered. */
  canFlyByHand: boolean;
  onFlyByHand: () => void;
  onAutomatic: () => void;
}

/** The spacecraft has reached the Moon: fly the landing yourself, or let the guidance computer do it. */
export function ArrivalScreen({
  timeline,
  plan,
  canFlyByHand,
  onFlyByHand,
  onAutomatic,
}: ArrivalScreenProps) {
  const t = TEXT.arrival;
  return (
    <section class="screen flight">
      <h1>
        {t.heading} {plan.siteName}
      </h1>
      <ol class="mission-log">
        {timeline.map((entry) => (
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
      <div class="flight-headline">
        <p>{t.summary}</p>
        <dl class="facts">
          <dt>{t.handover}</dt>
          <dd>
            {num(plan.startAltitudeM)} m · {num(plan.startDescentRateMS)} m/s {t.down} ·{' '}
            {num(plan.startGroundSpeedMS)} m/s {t.across}
          </dd>
          <dt>{t.propellant}</dt>
          <dd>
            {num(plan.availableDeltaV)} m/s{' '}
            <span class="dim">
              ({t.nominal} {num(plan.nominalDeltaV)} m/s)
            </span>
          </dd>
          <dt>{t.engine}</dt>
          <dd>
            {num(plan.thrustAcceleration / plan.gravity, 1)} × {t.lunarWeight}
          </dd>
          <dt>{t.limits}</dt>
          <dd>
            {num(plan.maxTouchdownSpeedMS)} m/s {t.down} · {num(plan.maxTouchdownDriftMS)} m/s {t.across}
          </dd>
        </dl>
      </div>
      {!canFlyByHand && <p class="banner">{TEXT.webgpu.unavailable}</p>}
      <div class="actions">
        <button
          type="button"
          class="button primary"
          data-autofocus
          disabled={!canFlyByHand}
          onClick={onFlyByHand}
        >
          {t.byHand}
        </button>
        <button type="button" class="button" onClick={onAutomatic}>
          {t.automatic}
        </button>
      </div>
    </section>
  );
}
