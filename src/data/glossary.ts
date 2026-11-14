// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
/** Plain-language definitions of the terms the game uses (source in `glossary_terms.json`). */
import { camelize } from '@/data/camelize';
import raw from '@/data/glossary_terms.json';

export interface GlossaryTerm {
  id: string;
  term: string;
  definition: string;
  /** Where in the game the term matters. */
  whereUsed: string;
}

export const GLOSSARY: readonly GlossaryTerm[] = camelize<GlossaryTerm[]>(raw.terms);
