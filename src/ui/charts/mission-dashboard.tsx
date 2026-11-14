// Gen Worlds © 2026 Echo Yin. PolyForm Noncommercial 1.0.0: see LICENSE.md.
import { num } from '@/mission/format';
import { SURFACE_MODES, type SurfaceMode, type SurfaceTelemetry } from '@/mission/surface-sim';
import { TEXT } from '@/ui/text';

export interface MissionDashboardProps {
  telemetry: SurfaceTelemetry;
  /** Mission day of touchdown: the dashboard's hour 0. */
  landingDay: number;
  /** Mission day the playback has reached; later hours are dimmed. Null shows everything. */
  playheadDay: number | null;
}

const WIDTH = 720;
const LEFT = 78;
const RIGHT = 8;
const TOP = 16;
const ROW = 14;
const GAP = 5;
const PLOT_H = 56;

/** Height of an activity bar as a share of its row, so the modes differ by shape as well as colour. */
const MODE_HEIGHT: Record<SurfaceMode, number> = {
  working: 1,
  in_shadow: 1,
  hibernating: 0.5,
  safe_mode: 0.25,
};

interface Run {
  from: number;
  to: number;
  value: number;
}

/** Collapses an hourly series into runs of equal value, so a strip is tens of rects, not thousands. */
function runs(values: Uint8Array, hours: number): Run[] {
  const out: Run[] = [];
  for (let hour = 0; hour < hours; hour++) {
    const last = out[out.length - 1];
    if (last && last.value === values[hour]) last.to = hour + 1;
    else out.push({ from: hour, to: hour + 1, value: values[hour] });
  }
  return out;
}

/**
 * Surface operations hour by hour, straight from the simulation: when the Sun and Earth were up,
 * what the vehicle was doing, its battery charge and the data it sent home.
 */
export function MissionDashboard({ telemetry, landingDay, playheadDay }: MissionDashboardProps) {
  const t = TEXT.dashboard;
  const total = telemetry.sunVisible.length;
  const hours = telemetry.hours;
  if (hours === 0) return null;
  const plot = WIDTH - LEFT - RIGHT;
  const x = (hour: number): number => LEFT + (hour / total) * plot;
  const now =
    playheadDay === null ? hours : Math.max(0, Math.min(hours, Math.round((playheadDay - landingDay) * 24)));
  const at = Math.max(0, now - 1);

  const sunY = TOP;
  const earthY = sunY + ROW + GAP;
  const modeY = earthY + ROW + GAP;
  const batteryY = modeY + ROW + GAP * 3;
  const dataY = batteryY + PLOT_H + GAP * 3;
  const bottom = dataY + PLOT_H;

  const strip = (values: Uint8Array, y: number, className: string) => (
    <g class={className}>
      {runs(values, total)
        .filter((run) => run.value === 1)
        .map((run) => (
          <rect key={run.from} x={x(run.from)} y={y} width={x(run.to) - x(run.from)} height={ROW} />
        ))}
    </g>
  );
  const line = (values: Float32Array, y: number, max: number): string => {
    // One point per 4 hours is finer than a pixel at this width.
    const points: string[] = [];
    for (let hour = 0; hour < hours; hour += 4) {
      points.push(`${x(hour + 1).toFixed(1)},${(y + PLOT_H * (1 - values[hour] / max)).toFixed(1)}`);
    }
    points.push(`${x(hours).toFixed(1)},${(y + PLOT_H * (1 - values[hours - 1] / max)).toFixed(1)}`);
    return points.join(' ');
  };
  let dataMax = 1;
  for (let hour = 0; hour < hours; hour++) {
    dataMax = Math.max(dataMax, telemetry.returnedGb[hour], telemetry.bufferGb[hour]);
  }
  const ticks: number[] = [];
  const tickStep = total > 24 * 60 ? 20 : 10;
  for (let day = 0; day * 24 <= total; day += tickStep) ticks.push(day);
  const mode = SURFACE_MODES[telemetry.mode[at]];

  return (
    <figure class="chart mission-dashboard">
      <dl class="dashboard-readout" aria-live="off">
        <div>
          <dt>{t.surfaceDay}</dt>
          <dd>{num(now / 24, 0)}</dd>
        </div>
        <div>
          <dt>{t.activity}</dt>
          <dd>{t.modes[mode]}</dd>
        </div>
        <div>
          <dt>{t.battery}</dt>
          <dd>{num(telemetry.batteryFraction[at] * 100, 0)} %</dd>
        </div>
        <div>
          <dt>{t.sun}</dt>
          <dd>{telemetry.sunVisible[at] ? t.up : t.down}</dd>
        </div>
        <div>
          <dt>{t.earth}</dt>
          <dd>{telemetry.earthVisible[at] ? t.inView : t.outOfView}</dd>
        </div>
        <div>
          <dt>{t.returned}</dt>
          <dd>{num(telemetry.returnedGb[at], 1)} Gb</dd>
        </div>
        <div>
          <dt>{t.onBoard}</dt>
          <dd>{num(telemetry.bufferGb[at], 1)} Gb</dd>
        </div>
        {telemetry.traverseKm[hours - 1] > 0 && (
          <div>
            <dt>{t.driven}</dt>
            <dd>{num(telemetry.traverseKm[at], 1)} km</dd>
          </div>
        )}
      </dl>
      <svg viewBox={`0 0 ${WIDTH} ${bottom + 16}`} role="img" aria-label={t.label}>
        {ticks.map((day) => (
          <g key={day} class="tick">
            <line x1={x(day * 24)} y1={TOP} x2={x(day * 24)} y2={bottom} />
            <text x={x(day * 24)} y={bottom + 12} text-anchor="middle">
              {day}
            </text>
          </g>
        ))}
        <text class="row-label" x={LEFT - 8} y={sunY + ROW * 0.78} text-anchor="end">
          {t.sun}
        </text>
        <text class="row-label" x={LEFT - 8} y={earthY + ROW * 0.78} text-anchor="end">
          {t.earth}
        </text>
        <text class="row-label" x={LEFT - 8} y={modeY + ROW * 0.78} text-anchor="end">
          {t.activity}
        </text>
        <text class="row-label" x={LEFT - 8} y={batteryY + PLOT_H / 2} text-anchor="end">
          {t.battery}
        </text>
        <text class="row-label" x={LEFT - 8} y={dataY + PLOT_H / 2} text-anchor="end">
          {t.data}
        </text>
        {strip(telemetry.sunVisible, sunY, 'sun')}
        {strip(telemetry.earthVisible, earthY, 'earth')}
        <g class="modes">
          {runs(telemetry.mode, hours).map((run) => {
            const name = SURFACE_MODES[run.value];
            const height = ROW * MODE_HEIGHT[name];
            return (
              <rect
                key={run.from}
                data-mode={name}
                x={x(run.from)}
                y={modeY + ROW - height}
                width={x(run.to) - x(run.from)}
                height={height}
              />
            );
          })}
        </g>
        <rect class="frame" x={LEFT} y={batteryY} width={plot} height={PLOT_H} />
        <rect class="frame" x={LEFT} y={dataY} width={plot} height={PLOT_H} />
        <polyline class="battery" points={line(telemetry.batteryFraction, batteryY, 1)} />
        <polyline class="buffer" points={line(telemetry.bufferGb, dataY, dataMax)} />
        <polyline class="returned" points={line(telemetry.returnedGb, dataY, dataMax)} />
        <text x={WIDTH - RIGHT - 3} y={dataY + 10} text-anchor="end">
          {num(dataMax, 0)} Gb
        </text>
        <text x={WIDTH - RIGHT - 3} y={batteryY + 10} text-anchor="end">
          100 %
        </text>
        {hours < total && (
          <g class="ended">
            <line x1={x(hours)} y1={TOP - 4} x2={x(hours)} y2={bottom} />
            <text x={x(hours) + 4} y={TOP - 6}>
              {t.ended}
            </text>
          </g>
        )}
        {now < hours && (
          <>
            <rect class="future" x={x(now)} y={TOP - 2} width={x(total) - x(now)} height={bottom - TOP + 4} />
            <line class="playhead" x1={x(now)} y1={TOP - 4} x2={x(now)} y2={bottom + 2} />
          </>
        )}
      </svg>
      <ul class="dashboard-legend">
        {SURFACE_MODES.map((name) => (
          <li key={name}>
            <span class="swatch" data-mode={name} style={{ height: `${0.7 * MODE_HEIGHT[name]}rem` }} />
            {t.modes[name]}
          </li>
        ))}
        <li>
          <span class="swatch line returned" />
          {t.returned}
        </li>
        <li>
          <span class="swatch line buffer" />
          {t.onBoard}
        </li>
      </ul>
      <figcaption>{t.caption}</figcaption>
    </figure>
  );
}
