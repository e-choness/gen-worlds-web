/** The mission loop in play order. Screens, co-op prompts and the debrief timeline all follow it. */
export const MISSION_PHASES = ['briefing', 'design', 'trajectory', 'poll', 'flight', 'debrief'] as const;

export type MissionPhase = (typeof MISSION_PHASES)[number];

/** The phase after `phase`, or null after the debrief (the loop then returns to design). */
export function nextPhase(phase: MissionPhase): MissionPhase | null {
  return MISSION_PHASES[MISSION_PHASES.indexOf(phase) + 1] ?? null;
}

export function previousPhase(phase: MissionPhase): MissionPhase | null {
  return MISSION_PHASES[MISSION_PHASES.indexOf(phase) - 1] ?? null;
}
