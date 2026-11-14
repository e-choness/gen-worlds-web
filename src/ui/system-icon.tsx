// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
import type { PartCategory } from '@/data/parts';

/** One line drawing per spacecraft system, on a 24-unit grid. Decorative: the name is always beside it. */
const PATHS: Record<PartCategory | 'trajectory', string> = {
  bus: 'M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8',
  power: 'M3 6h8v12H3zM13 6h8v12h-8zM3 12h8M13 12h8M7 6v12M17 6v12',
  battery: 'M4 8h14v8H4zM18 10.5h2v3h-2M8 10v4M11 10v4',
  propulsion: 'M9 4h6l1 8H8zM8 12l-3 8h14l-3-8M12 4V2',
  adcs: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2v2M12 20v2M2 12h2M20 12h2',
  computer: 'M7 7h10v10H7zM10 10h4v4h-4zM9 4v3M15 4v3M9 17v3M15 17v3M4 9h3M4 15h3M17 9h3M17 15h3',
  comms: 'M5 5a10 10 0 0 0 14 14zM12 12l6-6M17 4a3 3 0 0 1 3 3',
  thermal: 'M10 4a2 2 0 0 1 4 0v9a4 4 0 1 1-4 0zM12 8v8',
  mobility: 'M6 14a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM18 14a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM4 11h16v3H4zM7 11V7h8l3 4',
  landing: 'M8 4h8l2 7H6zM6 11l-3 9M18 11l3 9M12 11v6M2 20h4M18 20h4',
  instrument: 'M4 18l6-6M9 7l8 8M12 4l8 8-3 3-8-8zM4 20h8',
  trajectory: 'M3 19c6 0 5-12 12-12M15 7l-3-1M15 7l-1 3M19 5a1 1 0 1 0 0 2 1 1 0 0 0 0-2z',
};

export interface SystemIconProps {
  system: PartCategory | 'trajectory';
  /** Edge length in CSS pixels. */
  size?: number;
}

export function SystemIcon({ system, size = 24 }: SystemIconProps) {
  return (
    <svg
      class="system-icon"
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d={PATHS[system]} />
    </svg>
  );
}
