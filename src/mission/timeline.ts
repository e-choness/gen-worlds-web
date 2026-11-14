// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
/** One line of the mission's story: what happened, when, and which design decision was behind it. */
import type { PartCategory } from '@/data/parts';

export type TimelinePhase = 'development' | 'launch' | 'cruise' | 'landing' | 'surface';

export interface TimelineEntry {
  /** Days since launch (negative during development). */
  day: number;
  phase: TimelinePhase;
  /** `good`: something the design handled. `bad`: something it cost. */
  tone: 'good' | 'bad' | 'neutral';
  title: string;
  /** True when a design choice absorbed or softened an event: credited in the debrief. */
  mitigated: boolean;
  /** The cause and the consequence, shown verbatim. */
  detail: string;
  /** The part of the design responsible, for highlighting in the debrief. */
  slot: PartCategory | 'trajectory' | null;
}
