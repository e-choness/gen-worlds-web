// Gen Worlds © 2026 Echo Yin. PolyForm Noncommercial 1.0.0: see LICENSE.md.
import type { ComponentChildren } from 'preact';
import { isoDateFromJd } from '@/astro/time';
import type { SiteCalendar } from '@/mission/site-calendar';
import { TEXT } from '@/ui/text';

export interface SkyCalendarProps {
  calendar: SiteCalendar;
  /** Days from the calendar start to the landing, or null before a date is chosen. */
  landingDay: number | null;
  /** Length of the surface mission, days: drawn as a bracket from the landing. */
  missionDays: number;
  /** Last day of the window in which a landing is allowed. */
  windowDays: number;
  /** The date control, laid out under the strips so its travel matches the selectable days. */
  children?: ComponentChildren;
}

const WIDTH = 720;
const ROW = 22;
const LEFT = 58;
const TOP = 18;

/**
 * Two strips over the landing window: how much of each day the Sun is up and how much of it the
 * Earth is in view. Brightness is the share of the day; the bracket is the mission as scheduled.
 */
export function SkyCalendar({ calendar, landingDay, missionDays, windowDays, children }: SkyCalendarProps) {
  const days = calendar.sunByDay.length;
  const plot = WIDTH - LEFT - 8;
  const step = plot / days;
  const x = (day: number): number => LEFT + day * step;
  const t = TEXT.trajectory;

  // Month ticks along the top.
  const ticks: { day: number; label: string }[] = [];
  for (let day = 0; day < days; day++) {
    const iso = isoDateFromJd(calendar.startJd + day);
    if (iso.endsWith('-01')) ticks.push({ day, label: iso.slice(0, 7) });
  }
  const strip = (values: Float32Array, y: number, className: string) => (
    <g class={className}>
      {Array.from(values, (value, day) => (
        <rect
          key={day}
          x={x(day)}
          y={y}
          width={step + 0.3}
          height={ROW}
          style={{ opacity: 0.08 + 0.92 * value }}
        />
      ))}
    </g>
  );
  const sunY = TOP + 6;
  const earthY = sunY + ROW + 6;
  const bottom = earthY + ROW;

  return (
    <figure class="chart sky-calendar">
      <svg viewBox={`0 0 ${WIDTH} ${bottom + 26}`} role="img" aria-label={t.calendarLabel}>
        {ticks.map((tick) => (
          <g key={tick.day} class="tick">
            <line x1={x(tick.day)} y1={TOP} x2={x(tick.day)} y2={bottom} />
            <text x={x(tick.day) + 3} y={TOP - 4}>
              {tick.label}
            </text>
          </g>
        ))}
        <text class="row-label" x={LEFT - 8} y={sunY + ROW * 0.68} text-anchor="end">
          {t.sun}
        </text>
        <text class="row-label" x={LEFT - 8} y={earthY + ROW * 0.68} text-anchor="end">
          {t.earth}
        </text>
        {strip(calendar.sunByDay, sunY, 'sun')}
        {strip(calendar.earthByDay, earthY, 'earth')}
        {/* Dates after the window closes cannot be chosen for landing. */}
        <rect
          class="closed"
          x={x(windowDays)}
          y={TOP}
          width={Math.max(0, x(days) - x(windowDays))}
          height={bottom - TOP}
        />
        {landingDay !== null && (
          <g class="mission-span">
            <path
              d={`M${x(landingDay)},${TOP - 2} V${bottom + 8} H${x(Math.min(days, landingDay + missionDays))} V${TOP - 2}`}
            />
            <text x={x(landingDay) + 4} y={bottom + 21}>
              {t.missionSpan}
            </text>
          </g>
        )}
      </svg>
      {children && (
        <div
          class="calendar-control"
          style={{
            marginLeft: `${(LEFT / WIDTH) * 100}%`,
            width: `${((plot * windowDays) / days / WIDTH) * 100}%`,
          }}
        >
          {children}
        </div>
      )}
      <figcaption>{t.calendarCaption}</figcaption>
    </figure>
  );
}
