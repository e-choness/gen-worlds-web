/** Number formatting for the explanation strings the mission layer produces (pure, no DOM). */

/** Rounds to a sensible number of digits for its size and adds thousands separators. */
export function num(value: number, digits?: number): string {
  if (!Number.isFinite(value)) return '∞';
  const abs = Math.abs(value);
  // Whole numbers never get a trailing ".0".
  const places = digits ?? (Number.isInteger(value) || abs >= 100 ? 0 : abs >= 1 ? 1 : 2);
  const fixed = value.toFixed(places);
  const [whole, fraction] = fixed.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fraction ? `${grouped}.${fraction}` : grouped;
}

/** A 0–1 share as a whole percentage, e.g. 0.183 → "18 %". */
export function percent(fraction: number): string {
  return `${Math.round(fraction * 100)} %`;
}

/** A duration in hours as "9 h" or "3.2 days", whichever reads better. */
export function duration(hours: number): string {
  if (!Number.isFinite(hours)) return 'indefinitely';
  return hours < 48 ? `${num(hours, hours < 10 ? 1 : 0)} h` : `${num(hours / 24, 1)} days`;
}

export function money(musd: number): string {
  return `$${num(musd, musd < 10 ? 1 : 0)}M`;
}
