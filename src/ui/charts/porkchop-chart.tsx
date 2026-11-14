// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0 or MIT: see LICENSE.md.
import { useMemo } from 'preact/hooks';
import type { PorkchopGrid } from '@/astro/interplanetary';
import { isoDateFromJd } from '@/astro/time';
import { TEXT } from '@/ui/text';

export interface PorkchopChartProps {
  grid: PorkchopGrid;
  /** Arrival excess speed above which the heat shield fails, km/s, or null when there is no limit. */
  maxArrivalKmS: number | null;
  departureJd: number | null;
  arrivalJd: number | null;
  onPick: (departureJd: number, arrivalJd: number) => void;
}

const WIDTH = 720;
const HEIGHT = 420;
const PAD = { left: 78, right: 12, top: 12, bottom: 34 };
/** Launch energies mapped onto the colour scale, km²/s² (logarithmic between them). */
const C3_BRIGHT = 8;
const C3_DARK = 80;
/** Launch energies drawn as contour bands in the legend. */
const LEGEND_C3 = [10, 15, 25, 40, 80];

/** Cheap launch = bright; expensive = dark. Arrivals too fast for the heat shield lose their colour. */
function colour(c3: number, tooFast: boolean): [number, number, number] {
  if (!Number.isFinite(c3)) return [6, 10, 18];
  const t = Math.min(1, Math.max(0, Math.log(c3 / C3_BRIGHT) / Math.log(C3_DARK / C3_BRIGHT)));
  // Bands make the contours readable without drawing lines.
  const banded = Math.floor(t * 8) / 8;
  const light = 1 - banded;
  const r = 20 + 235 * light ** 1.6;
  const g = 40 + 190 * light ** 1.1;
  const b = 70 + 60 * light ** 0.6;
  if (!tooFast) return [r, g, b];
  const grey = (r + g + b) / 3;
  return [grey * 0.45, grey * 0.45, grey * 0.5];
}

function monthTicks(startJd: number, endJd: number): { jd: number; label: string }[] {
  const ticks: { jd: number; label: string }[] = [];
  for (let jd = Math.ceil(startJd); jd <= endJd; jd++) {
    const iso = isoDateFromJd(jd);
    if (iso.endsWith('-01')) ticks.push({ jd, label: iso.slice(0, 7) });
  }
  return ticks;
}

/**
 * The porkchop plot: every launch date against every arrival date, coloured by the launch energy
 * the rocket must supply. Click or drag to choose a pair of dates.
 */
export function PorkchopChart({ grid, maxArrivalKmS, departureJd, arrivalJd, onPick }: PorkchopChartProps) {
  const t = TEXT.porkchop;
  const plotW = WIDTH - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const image = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = grid.columns;
    canvas.height = grid.rows;
    const context = canvas.getContext('2d');
    if (!context) return '';
    const pixels = context.createImageData(grid.columns, grid.rows);
    for (let row = 0; row < grid.rows; row++) {
      for (let column = 0; column < grid.columns; column++) {
        const index = row * grid.columns + column;
        const tooFast = maxArrivalKmS !== null && grid.vInfinityArrival[index] > maxArrivalKmS;
        const [r, g, b] = colour(grid.c3[index], tooFast);
        // Row 0 is the earliest arrival: draw it at the bottom.
        const offset = ((grid.rows - 1 - row) * grid.columns + column) * 4;
        pixels.data[offset] = r;
        pixels.data[offset + 1] = g;
        pixels.data[offset + 2] = b;
        pixels.data[offset + 3] = 255;
      }
    }
    context.putImageData(pixels, 0, 0);
    return canvas.toDataURL();
  }, [grid, maxArrivalKmS]);

  const x = (jd: number): number =>
    PAD.left + ((jd - grid.departureJdStart) / (grid.departureJdEnd - grid.departureJdStart)) * plotW;
  const y = (jd: number): number =>
    PAD.top + (1 - (jd - grid.arrivalJdStart) / (grid.arrivalJdEnd - grid.arrivalJdStart)) * plotH;

  const pick = (event: PointerEvent): void => {
    const svg = event.currentTarget as SVGSVGElement;
    const box = svg.getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * WIDTH;
    const py = ((event.clientY - box.top) / box.height) * HEIGHT;
    const fx = Math.min(1, Math.max(0, (px - PAD.left) / plotW));
    const fy = Math.min(1, Math.max(0, 1 - (py - PAD.top) / plotH));
    onPick(
      Math.round(grid.departureJdStart + fx * (grid.departureJdEnd - grid.departureJdStart)),
      Math.round(grid.arrivalJdStart + fy * (grid.arrivalJdEnd - grid.arrivalJdStart)),
    );
  };

  return (
    <figure class="chart porkchop">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        role="img"
        aria-label={t.label}
        onPointerDown={(event) => {
          (event.currentTarget as SVGSVGElement).setPointerCapture(event.pointerId);
          pick(event);
        }}
        onPointerMove={(event) => {
          if (event.buttons & 1) pick(event);
        }}
      >
        <image
          href={image}
          x={PAD.left}
          y={PAD.top}
          width={plotW}
          height={plotH}
          preserveAspectRatio="none"
        />
        {monthTicks(grid.departureJdStart, grid.departureJdEnd).map((tick) => (
          <g key={tick.jd} class="tick">
            <line x1={x(tick.jd)} y1={PAD.top} x2={x(tick.jd)} y2={PAD.top + plotH + 4} />
            <text x={x(tick.jd)} y={HEIGHT - 20} text-anchor="middle">
              {tick.label.slice(2)}
            </text>
          </g>
        ))}
        {monthTicks(grid.arrivalJdStart, grid.arrivalJdEnd).map((tick) => (
          <g key={tick.jd} class="tick">
            <line x1={PAD.left - 4} y1={y(tick.jd)} x2={PAD.left + plotW} y2={y(tick.jd)} />
            <text x={PAD.left - 8} y={y(tick.jd) + 3} text-anchor="end">
              {tick.label}
            </text>
          </g>
        ))}
        <text class="axis-label" x={PAD.left + plotW / 2} y={HEIGHT - 4} text-anchor="middle">
          {t.launchAxis}
        </text>
        <text
          class="axis-label"
          transform={`translate(12 ${PAD.top + plotH / 2}) rotate(-90)`}
          text-anchor="middle"
        >
          {t.arrivalAxis}
        </text>
        {departureJd !== null && arrivalJd !== null && (
          <g class="pick">
            <line x1={x(departureJd)} y1={PAD.top} x2={x(departureJd)} y2={PAD.top + plotH} />
            <line x1={PAD.left} y1={y(arrivalJd)} x2={PAD.left + plotW} y2={y(arrivalJd)} />
            <circle cx={x(departureJd)} cy={y(arrivalJd)} r={6} />
          </g>
        )}
      </svg>
      <ul class="porkchop-legend">
        {LEGEND_C3.map((c3) => {
          const [r, g, b] = colour(c3 * 0.99, false);
          return (
            <li key={c3}>
              <span class="swatch" style={{ background: `rgb(${r} ${g} ${b})` }} />≤ {c3}
            </li>
          );
        })}
        <li>{t.legendUnit}</li>
        {maxArrivalKmS !== null && (
          <li>
            <span class="swatch grey" />
            {t.tooFast}
          </li>
        )}
      </ul>
      <figcaption>{t.caption}</figcaption>
    </figure>
  );
}
