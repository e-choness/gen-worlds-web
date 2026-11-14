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
  status: {
    ok: 'OK',
    warning: 'Warning',
    fail: 'Fail',
    incomplete: 'To do',
  },
  design: {
    budgets: 'Budgets',
    issues: 'Design notes',
    critical: 'critical',
    slots: 'Spacecraft systems',
    empty: 'Nothing chosen',
    optional: 'optional',
    none: 'None',
    noneSummary: 'Leave this slot empty.',
    installed: 'Installed',
    install: 'Install',
    remove: 'Remove',
    add: 'Add',
    effect: 'If chosen:',
    noEffect: 'No change to the budgets.',
    instrumentsCount: 'chosen',
    redundancy: 'Carry a backup unit',
    redundancyNote: 'About twice the mass and cost for a tenth of the failure rate.',
    loadReference: 'Load the NASA-style baseline',
    clear: 'Clear the design',
    vehicle: 'Vehicle',
    vehicleEmpty: 'Choose a frame to start the vehicle.',
    next: 'Plan the trajectory',
  },
  trajectory: {
    vehicle: 'Launch vehicle',
    transfer: 'Route to the Moon',
    site: 'Landing site',
    date: 'Landing date',
    choose: 'Choose',
    chosen: 'Chosen',
    cost: 'Price',
    reliability: 'Success rate',
    lifts: 'Lifts on this route',
    duration: 'Duration',
    days: 'days',
    energy: 'Launch energy',
    braking: 'Braking at the Moon',
    ice: 'Ice richness',
    toIce: 'Drive to the ice',
    inIce: 'on the ice',
    hazard: 'Landing risk',
    slope: 'Slopes',
    sun: 'Sunlight',
    earth: 'Earth',
    missionSpan: 'surface mission',
    landing: 'Landing',
    launch: 'launch',
    dateHint: 'Move the slider to choose the landing date.',
    siteFirst: 'Choose a landing site to see its sunlight and Earth visibility through the year.',
    calendarLabel: 'Daily sunlight and Earth visibility at the landing site across the landing window',
    calendarCaption:
      'Brighter means more of that day with the Sun up (top) or the Earth in view (bottom). The bracket is your surface mission: keep it in the light. A late launch slides it to the right.',
    capacityLabel: 'Payload each launch vehicle can send against launch energy',
    capacityCaption:
      'Each curve is what a rocket can send away from Earth: less the more energy the route needs. The dot is your spacecraft on the chosen route; a rocket whose curve passes above it can fly the mission.',
    capacityAt: 'The chosen rocket lifts',
    needed: 'spacecraft',
    c3Axis: 'launch energy C3, km²/s²',
    next: 'Call the Go/No-Go poll',
  },
  stats: {
    mass: 'Mass',
    cost: 'Cost',
    draw: 'Draws',
    carries: 'Carries',
    area: 'Area',
    output: 'Output',
    heat: 'Waste heat',
    usable: 'Usable',
    isp: 'Specific impulse',
    thrust: 'Thrust',
    pointing: 'Pointing',
    class: 'class',
    storage: 'Storage',
    radiation: 'Radiation',
    hardened: 'hardened',
    notHardened: 'not hardened',
    rate: 'Up to',
    needsPointing: 'Needs pointing',
    heatLoss: 'Heat loss',
    freeHeat: 'Free heat',
    pace: 'Pace',
    slope: 'Climbs',
    accuracy: 'Accuracy',
    landingRisk: 'Landing risk',
    data: 'Data',
    depth: 'Depth',
    readiness: 'Readiness',
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
