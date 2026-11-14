/**
 * The one game-state store. Screens read its signals and ask for changes through its methods; they
 * never write the signals themselves.
 */
import { computed, effect, type ReadonlySignal, type Signal, signal } from '@preact/signals';
import type { Disposable } from '@/core/disposable';
import { ROLE_IDS, type RoleId, type TierId } from '@/data/mission-constants';
import { findPart, type SlotId } from '@/data/parts';
import { SCENARIOS } from '@/data/scenarios';
import { createEmptyDesign, type MissionDesign, type TrajectoryChoice } from '@/mission/design';
import { type DesignEvaluation, evaluateDesign } from '@/mission/evaluate-design';
import type { MonteCarloSummary } from '@/mission/monte-carlo';
import { emptyVotes, type PollVotes, pollOutcome, type RoleVote } from '@/mission/poll';
import type { MissionOutcome } from '@/mission/scoring';
import { type MissionResult, simulateMission } from '@/mission/simulate-mission';
import { hashForScreen, isMissionPhase, type ScreenId, screenFromHash } from '@/ui/screen-id';

/** 'checking' until the adapter request settles; the 3D paths stay closed unless 'available'. */
export type WebgpuSupport = 'checking' | 'available' | 'unavailable';

/** Something that can run a Monte Carlo forecast off the main thread. */
export interface Forecaster {
  run(design: MissionDesign, runs: number, seed: number): Promise<MonteCarloSummary>;
}

export type ForecastState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'done'; summary: MonteCarloSummary }
  | { status: 'failed'; error: string };

/** One flown mission, kept for comparison with later runs. */
export interface MissionRun {
  id: number;
  /** Unix time of the launch, ms. */
  at: number;
  seed: number;
  design: MissionDesign;
  score: number;
  outcome: MissionOutcome;
  headline: string;
}

const DESIGN_KEY = 'gen-worlds.design.v1';
const RUNS_KEY = 'gen-worlds.runs.v1';
const MAX_RUNS = 20;
const FORECAST_RUNS = 200;

function load<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') as T | null;
  } catch {
    return null;
  }
}

function save(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be blocked (private mode): the game still plays, it just forgets on reload.
  }
}

function knownScenario(design: MissionDesign | null | undefined): design is MissionDesign {
  // A design from an older build may name a scenario that no longer exists.
  return !!design && SCENARIOS.some((scenario) => scenario.id === design.scenarioId);
}

/** A fresh seed for a new flight. Not world content: every run is replayable from the seed it shows. */
function newSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

export class GameStore implements Disposable {
  readonly screen: Signal<ScreenId>;
  readonly webgpu = signal<WebgpuSupport>('checking');
  /** Set when the 3D engine failed to start; shown verbatim on the sandbox screen. */
  readonly engineError = signal<string | null>(null);
  /** Difficulty chosen on the scenario screen; a design carries its own copy. */
  readonly tier = signal<TierId>('engineer');
  /** The design in progress, or null before a scenario is chosen. */
  readonly design: Signal<MissionDesign | null>;
  /** Budgets, issues and derived models of the current design, recomputed on every change. */
  readonly evaluation: ReadonlySignal<DesignEvaluation | null>;
  /** Go/No-Go votes; cleared whenever the design changes. */
  readonly votes = signal<PollVotes>(emptyVotes());
  /** Monte Carlo forecast of the current design; cleared whenever the design changes. */
  readonly forecast = signal<ForecastState>({ status: 'idle' });
  /** The mission just flown, or null before the first launch of this session. */
  readonly result = signal<MissionResult | null>(null);
  /** Past runs, newest first. */
  readonly history: Signal<MissionRun[]>;

  private readonly stopPersisting: () => void;
  private readonly onHashChange = (): void => {
    this.screen.value = this.guard(screenFromHash(location.hash));
  };

  constructor(
    initial: ScreenId,
    private readonly forecaster: Forecaster,
  ) {
    const saved = load<MissionDesign>(DESIGN_KEY);
    this.design = signal(knownScenario(saved) ? saved : null);
    if (this.design.value) this.tier.value = this.design.value.tier;
    this.history = signal((load<MissionRun[]>(RUNS_KEY) ?? []).filter((run) => knownScenario(run.design)));
    this.evaluation = computed(() => (this.design.value ? evaluateDesign(this.design.value) : null));
    this.screen = signal(this.guard(initial));
    // The hash is the source of truth for the screen, so browser Back and deep links just work.
    addEventListener('hashchange', this.onHashChange);
    this.stopPersisting = effect(() => {
      save(DESIGN_KEY, this.design.value);
      save(RUNS_KEY, this.history.value);
    });
  }

  /** Screens that need something that does not exist yet fall back to where it gets made. */
  private guard(screen: ScreenId): ScreenId {
    if (isMissionPhase(screen) && !this.design.value) return 'scenarios';
    if ((screen === 'flight' || screen === 'debrief') && !this.result.value) return 'poll';
    return screen;
  }

  navigate(screen: ScreenId): void {
    const hash = hashForScreen(this.guard(screen));
    if (location.hash === hash) this.screen.value = this.guard(screen);
    else location.hash = hash;
  }

  /** Every design change goes through here: votes and forecasts describe the old design. */
  private commit(design: MissionDesign): void {
    this.design.value = design;
    this.votes.value = emptyVotes();
    this.forecast.value = { status: 'idle' };
  }

  setTier(tier: TierId): void {
    this.tier.value = tier;
    const design = this.design.value;
    if (design) this.commit({ ...design, tier });
  }

  /** Starts a fresh design for a scenario, or keeps the one in progress if it is the same scenario. */
  selectScenario(scenarioId: string): void {
    const current = this.design.value;
    if (current?.scenarioId === scenarioId) this.commit({ ...current, tier: this.tier.value });
    else this.commit(createEmptyDesign(scenarioId, this.tier.value));
  }

  /** Puts a part in its slot (the slot is the part's category), or empties the slot with null. */
  setSlot(slot: SlotId, partId: string | null): void {
    const design = this.design.value;
    if (!design) return;
    const slots = { ...design.slots };
    if (partId && findPart(partId)?.category === slot) slots[slot] = partId;
    else delete slots[slot];
    this.commit({ ...design, slots });
  }

  toggleInstrument(partId: string): void {
    const design = this.design.value;
    if (!design) return;
    const instruments = design.instruments.includes(partId)
      ? design.instruments.filter((id) => id !== partId)
      : [...design.instruments, partId];
    this.commit({ ...design, instruments });
  }

  toggleRedundant(slot: SlotId): void {
    const design = this.design.value;
    if (!design) return;
    const redundant = design.redundant.includes(slot)
      ? design.redundant.filter((id) => id !== slot)
      : [...design.redundant, slot];
    this.commit({ ...design, redundant });
  }

  setTrajectory(change: Partial<TrajectoryChoice>): void {
    const design = this.design.value;
    if (!design) return;
    this.commit({ ...design, trajectory: { ...design.trajectory, ...change } });
  }

  /** Replaces the whole design (loading a saved design, a mission code or a reference design). */
  loadDesign(design: MissionDesign): void {
    this.tier.value = design.tier;
    this.commit(design);
  }

  setVote(role: RoleId, vote: Partial<RoleVote>): void {
    this.votes.value = { ...this.votes.value, [role]: { ...this.votes.value[role], ...vote } };
  }

  /** A single player holds all four roles and may call them together. */
  voteAllGo(): void {
    const votes = { ...this.votes.value };
    for (const role of ROLE_IDS) votes[role] = { vote: 'go', reason: '' };
    this.votes.value = votes;
  }

  /** Starts a 200-mission forecast of the current design in the background. */
  requestForecast(): void {
    const design = this.design.value;
    if (!design || !this.evaluation.value?.launchable) return;
    this.forecast.value = { status: 'running' };
    this.forecaster.run(design, FORECAST_RUNS, 20261114).then(
      (summary) => {
        // Ignore an answer for a design that has since changed.
        if (this.design.value === design) this.forecast.value = { status: 'done', summary };
      },
      (error: Error) => {
        if (this.design.value === design) this.forecast.value = { status: 'failed', error: error.message };
      },
    );
  }

  /**
   * Flies the mission with a fresh seed and opens the flight screen. Does nothing unless the poll
   * has passed. Pass a seed to replay a known run.
   */
  launch(seed: number = newSeed()): void {
    const design = this.design.value;
    const evaluation = this.evaluation.value;
    if (!design || !evaluation || !pollOutcome(this.votes.value, evaluation).canLaunch) return;
    const result = simulateMission(design, seed);
    this.result.value = result;
    const run: MissionRun = {
      id: (this.history.value[0]?.id ?? 0) + 1,
      at: Date.now(),
      seed,
      design,
      score: result.score.total,
      outcome: result.score.outcome,
      headline: result.headline,
    };
    this.history.value = [run, ...this.history.value].slice(0, MAX_RUNS);
    this.navigate('flight');
  }

  dispose(): void {
    removeEventListener('hashchange', this.onHashChange);
    this.stopPersisting();
  }
}
