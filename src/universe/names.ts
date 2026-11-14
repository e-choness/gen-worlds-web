// Gen Worlds © 2026 Echo Yin. PolyForm Noncommercial 1.0.0: see LICENSE.md.
import type { Rng } from '@/core/random';

const ONSETS = [
  '',
  'b',
  'c',
  'd',
  'f',
  'g',
  'h',
  'k',
  'l',
  'm',
  'n',
  'p',
  'r',
  's',
  't',
  'v',
  'z',
  'th',
  'sh',
  'kr',
  'tr',
  'dr',
  'gl',
  'br',
  'st',
  'v',
  'x',
  'y',
  'qu',
];
const NUCLEI = ['a', 'e', 'i', 'o', 'u', 'a', 'e', 'o', 'ae', 'ia', 'ei', 'ou', 'y', 'io', 'ea'];
const CODAS = ['', '', '', 'n', 'r', 's', 'l', 'th', 'x', 'm', 'k', 'nd', 'rn', 'ss', 'sh'];
const CATALOGS = ['HD', 'GJ', 'KOI', 'TYC', 'HIP', 'PSR', 'LHS', 'WISE'];
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

function word(rng: Rng, syllables: number): string {
  let out = '';
  for (let i = 0; i < syllables; i++) {
    out += rng.pick(ONSETS) + rng.pick(NUCLEI);
    if (i === syllables - 1 || rng.chance(0.25)) out += rng.pick(CODAS);
  }
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/** A pronounceable proper name for notable stars, a catalogue designation for the rest. */
export function starName(rng: Rng): string {
  if (rng.chance(0.55)) return word(rng, rng.int(2, 3));
  return `${rng.pick(CATALOGS)} ${rng.int(1000, 99999)}`;
}

export function planetName(starLabel: string, index: number): string {
  return `${starLabel} ${ROMAN[index] ?? String(index + 1)}`;
}

export function moonName(planetLabel: string, index: number): string {
  return `${planetLabel}-${String.fromCharCode(97 + index)}`;
}
