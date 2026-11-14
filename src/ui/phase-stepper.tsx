// Gen Worlds © 2026 Echo Yin. PolyForm Noncommercial 1.0.0: see LICENSE.md.
import { MISSION_PHASES, type MissionPhase } from '@/mission/phases';
import { PHASE_TEXT, TEXT } from '@/ui/text';

export interface PhaseStepperProps {
  /** Null outside the mission loop (title, scenario select). */
  current: MissionPhase | null;
  onSelect: (phase: MissionPhase) => void;
}

/** The mission loop as a numbered step list: where the team is, and a way back to earlier phases. */
export function PhaseStepper({ current, onSelect }: PhaseStepperProps) {
  const currentIndex = current ? MISSION_PHASES.indexOf(current) : -1;
  return (
    <nav class="stepper" aria-label={TEXT.nav.phases}>
      <ol>
        {MISSION_PHASES.map((phase, index) => {
          const state = index === currentIndex ? 'current' : index < currentIndex ? 'done' : 'ahead';
          return (
            <li key={phase} data-state={state}>
              <button
                type="button"
                aria-current={state === 'current' ? 'step' : undefined}
                // Later phases need the output of earlier ones, so only visited steps are reachable.
                disabled={state === 'ahead'}
                onClick={() => onSelect(phase)}
              >
                <span class="step-number">{index + 1}</span>
                {PHASE_TEXT[phase].label}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
