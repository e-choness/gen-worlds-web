/**
 * All user-facing copy of the 2D screens lives here, so wording, tone and a later translation are
 * one file. Consequence explanations ("why" strings) come from the mission layer, not from here.
 */
import type { ResourceId } from '@/data/scenarios';
import type { MissionPhase } from '@/mission/phases';

export const TEXT = {
  brand: 'Gen Worlds',
  tagline: 'Space Mission Design Game',
  title: {
    eyebrow: 'NASA Space Apps Challenge 2026',
    lede: 'Plan a real NASA-style mission, from science goal to spacecraft to launch. Then fly it and watch every trade-off play out.',
    newMission: 'New mission',
    sandbox: 'Explore the sandbox galaxy',
    sandboxNeedsWebgpu: 'Sandbox needs WebGPU',
    footnote: '1 to 4 players · real physics · real NASA data',
  },
  scenarios: {
    heading: 'Choose a mission',
    summary: 'Each scenario has its own objective, budget cap and critical resources.',
    next: 'Open the briefing',
    tier: 'Difficulty',
    mission: 'Mission',
    critical: 'Critical:',
  },
  briefing: {
    objectives: 'Science objectives',
    weightTitle: 'Share of the science score',
    constraints: 'Constraints',
    budget: 'Budget cap',
    budgetNote: 'spacecraft, launch and operations',
    duration: 'Surface mission',
    days: 'days',
    window: 'Landing window',
    critical: 'Critical resources',
    sites: 'Candidate sites',
    nasa: 'How NASA approached it',
    readMore: 'Read about the mission at nasa.gov',
    next: 'Start the design',
  },
  nav: {
    back: 'Back',
    home: 'Title screen',
    phases: 'Mission phases',
  },
  webgpu: {
    unavailable:
      'This browser has no WebGPU, so the 3D flight is replaced by the fast simulation with a 2D timeline. Everything else plays the same.',
    sandboxStarting: 'Starting the 3D engine…',
    sandboxFailed: 'The 3D sandbox could not start.',
  },
  stub: 'This screen is being built.',
} as const;

export interface PhaseText {
  /** Short name for the stepper. */
  label: string;
  heading: string;
  summary: string;
  /** Label of the button that moves on to the next phase. */
  next: string;
}

export const PHASE_TEXT: Record<MissionPhase, PhaseText> = {
  briefing: {
    label: 'Briefing',
    heading: 'Mission briefing',
    summary: 'Read the objective, requirements, budget cap and launch window, and assign the team roles.',
    next: 'Start the design',
  },
  design: {
    label: 'Design',
    heading: 'Spacecraft design',
    summary:
      'Pick every subsystem and instrument. Each part shows its effect on mass, power, data and cost before you commit.',
    next: 'Plan the trajectory',
  },
  trajectory: {
    label: 'Trajectory',
    heading: 'Launch and trajectory',
    summary: 'Choose the launch vehicle, the dates and the arrival orbit or landing site.',
    next: 'Call the Go/No-Go poll',
  },
  poll: {
    label: 'Go / No-Go',
    heading: 'Go / No-Go poll',
    summary: 'Every role votes. A No-Go must give a reason.',
    next: 'Launch',
  },
  flight: {
    label: 'Flight',
    heading: 'Flight',
    summary: 'Launch, cruise, arrival and surface operations, flown hands-on or run as a fast simulation.',
    next: 'Open the debrief',
  },
  debrief: {
    label: 'Debrief',
    heading: 'Mission debrief',
    summary: 'Score, timeline and the cause of every outcome, traced back to your design decisions.',
    next: 'Change the design and rerun',
  },
};

/** Names of the resources the budget panel tracks. */
export const RESOURCE_NAMES: Record<ResourceId, string> = {
  mass: 'Mass',
  delta_v: 'Propellant',
  launch: 'Launch',
  power: 'Power',
  thermal: 'Shadow and night',
  data: 'Data',
  cost: 'Budget',
  schedule: 'Schedule',
  risk: 'Risk',
};
