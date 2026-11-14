import type { ComponentChildren } from 'preact';
import { TEXT } from '@/ui/text';

export interface StubScreenProps {
  heading: string;
  summary: string;
  nextLabel: string;
  onNext: () => void;
  onBack: () => void;
  children?: ComponentChildren;
}

/** Placeholder for a screen of the loop that is not built yet: keeps the whole flow walkable. */
export function StubScreen({ heading, summary, nextLabel, onNext, onBack, children }: StubScreenProps) {
  return (
    <section class="screen">
      <h1>{heading}</h1>
      <p class="lede">{summary}</p>
      {children}
      <p class="placeholder">{TEXT.stub}</p>
      <div class="actions">
        <button type="button" class="button" onClick={onBack}>
          {TEXT.nav.back}
        </button>
        <button type="button" class="button primary" data-autofocus onClick={onNext}>
          {nextLabel}
        </button>
      </div>
    </section>
  );
}
