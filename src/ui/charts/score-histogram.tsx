// Gen Worlds © 2026 Echo Yin. PolyForm Noncommercial 1.0.0: see LICENSE.md.
import { TEXT } from '@/ui/text';

export interface ScoreHistogramProps {
  /** Scores of the simulated missions, in any order. */
  scores: readonly number[];
}

const BINS = 16;
const WIDTH = 320;
const HEIGHT = 90;

/** How the simulated missions' scores are spread: tall bars at the right mean a dependable design. */
export function ScoreHistogram({ scores }: ScoreHistogramProps) {
  const max = Math.max(...scores, 1);
  const counts = new Array<number>(BINS).fill(0);
  for (const score of scores) counts[Math.min(BINS - 1, Math.floor((score / max) * BINS))]++;
  const tallest = Math.max(...counts, 1);
  const barWidth = WIDTH / BINS;
  return (
    <figure class="chart histogram">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT + 16}`} role="img" aria-label={TEXT.poll.histogramLabel}>
        {counts.map((count, bin) => {
          const height = (count / tallest) * HEIGHT;
          return (
            <rect
              key={bin}
              x={bin * barWidth + 1}
              y={HEIGHT - height}
              width={barWidth - 2}
              height={Math.max(height, count > 0 ? 1.5 : 0)}
            />
          );
        })}
        <line x1="0" y1={HEIGHT} x2={WIDTH} y2={HEIGHT} />
        <text x="0" y={HEIGHT + 13}>
          0
        </text>
        <text x={WIDTH} y={HEIGHT + 13} text-anchor="end">
          {Math.round(max)} {TEXT.poll.points}
        </text>
      </svg>
    </figure>
  );
}
