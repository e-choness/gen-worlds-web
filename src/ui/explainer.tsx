// Gen Worlds © 2026 Echo Yin. PolyForm Noncommercial 1.0.0: see LICENSE.md.
import type { MissionPhase } from '@/mission/phases';
import { TEXT } from '@/ui/text';

export interface ExplainerProps {
  phase: MissionPhase;
  /** Open by default for new players (the Cadet level); a click away for everyone else. */
  open: boolean;
}

/** What this screen is for and how to read it: the tutorial, folded into every step of the loop. */
export function Explainer({ phase, open }: ExplainerProps) {
  const help = TEXT.help[phase];
  return (
    // Keyed by phase so each screen starts in its own default state.
    <details class="explainer" open={open} key={phase}>
      <summary>
        {TEXT.help.label} {help.title}
      </summary>
      <ol>
        {help.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </details>
  );
}
