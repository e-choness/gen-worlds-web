// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0 or MIT: see LICENSE.md.
/**
 * The one game-state store. Screens read its signals and ask for changes through its methods; they
 * never write the signals themselves.
 *
 * With a crew (`room` set) every shared change goes out as a field patch through the net adapter
 * and comes back through `applyRoom`, the same way for a crew on one screen and a crew online.
 */
import { computed, effect, type ReadonlySignal, type Signal, signal } from '@preact/signals';
import { MemoryAdapter } from '@/coop/memory-adapter';
import type { NetAdapter } from '@/coop/net-adapter';
import {
  createRoom,
  designPatch,
  newRoomCode,
  normaliseRoomCode,
  type RoomFlight,
  type RoomPatch,
  type RoomState,
  rolesOf,
  sameData,
} from '@/coop/room';
import type { ScoreBoard, ScoreEntry } from '@/coop/score-board';
import type { Disposable } from '@/core/disposable';
import { hashString } from '@/core/random';
import { ROLE_IDS, type RoleId, type TierId } from '@/data/mission-constants';
import { findPart, type SlotId } from '@/data/parts';
import { SCENARIOS } from '@/data/scenarios';
import {
  type DescentOutcome,
  type DescentPlan,
  landingInputFromDescent,
  planDescent,
} from '@/mission/descent-plan';
import { createEmptyDesign, type MissionDesign, type TrajectoryChoice } from '@/mission/design';
import { type DesignEvaluation, evaluateDesign } from '@/mission/evaluate-design';
import { type InputLog, type LandingInput, SCRIPTED_INPUT_LOG } from '@/mission/input-log';
import { decodeMissionCode, encodeMissionCode } from '@/mission/mission-code';
import type { MonteCarloSummary } from '@/mission/monte-carlo';
import { emptyVotes, type PollVotes, pollOutcome, type RoleVote } from '@/mission/poll';
import { roleForSlot, roleForTrajectoryField } from '@/mission/roles';
import type { MissionOutcome } from '@/mission/scoring';
import { type MissionResult, simulateMission } from '@/mission/simulate-mission';
import { hashForScreen, isMissionPhase, type ScreenId, screenFromHash } from '@/ui/screen-id';
import { TEXT } from '@/ui/text';

/** 'checking' until the adapter request settles; the 3D paths stay closed unless 'available'. */
export type WebgpuSupport = 'checking' | 'available' | 'unavailable';

/** Something that can run a Monte Carlo forecast off the main thread. */
export interface Forecaster {
  run(design: MissionDesign, runs: number, seed: number): Promise<MonteCarloSummary>;
}

/** Opens the online adapter; null where the build has no online configuration. */
export type OnlineAdapterFactory = (() => Promise<NetAdapter>) | null;

export type ForecastState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'done'; summary: MonteCarloSummary }
  | { status: 'failed'; error: string };

/** Opens the global leaderboard; null where the build has no online configuration. */
export type ScoreBoardFactory = (() => Promise<ScoreBoard>) | null;

/** A leaderboard line this client has checked by flying the entry's mission code itself. */
export interface VerifiedScore {
  name: string;
  score: number;
  scenario: string;
  daily: string | null;
  at: number;
}

export type ScoresState =
  | { status: 'idle' | 'loading'; entries: VerifiedScore[] }
  | { status: 'done'; entries: VerifiedScore[] }
  | { status: 'failed'; entries: VerifiedScore[]; error: string };

/** A fixed seed everyone flies: from a shared mission link, or the daily mission. */
export interface Challenge {
  seed: number;
  /** ISO date of the daily mission, or null for a shared link. */
  daily: string | null;
}

/** One flown mission, kept for comparison with later runs. */
export interface MissionRun {
  id: number;
  /** Unix time of the launch, ms. */
  at: number;
  seed: number;
  design: MissionDesign;
  /** What the crew did by hand, so the run can be re-simulated and verified. */
  inputLog?: InputLog;
  score: number;
  outcome: MissionOutcome;
  headline: string;
}

const DESIGN_KEY = 'gen-worlds.design.v1';
const RUNS_KEY = 'gen-worlds.runs.v1';
const NAME_KEY = 'gen-worlds.name.v1';
const MAX_RUNS = 20;
const FORECAST_RUNS = 200;
const HEARTBEAT_MS = 45_000;
const MAX_LOCAL_PLAYERS = 4;
const BOARD_SIZE = 100;

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

/** Flies a leaderboard entry's mission code; the entry counts only if the score comes out the same. */
function verifyScore(entry: ScoreEntry): VerifiedScore[] {
  const mission = decodeMissionCode(entry.code);
  if (!mission || mission.seed === null || mission.design.scenarioId !== entry.scenario) return [];
  try {
    const result = simulateMission(mission.design, mission.seed, mission.inputLog ?? SCRIPTED_INPUT_LOG);
    if (result.score.total !== entry.score) return [];
  } catch {
    // A design that cannot launch never flew.
    return [];
  }
  return [
    {
      name: String(entry.name).slice(0, 20),
      score: entry.score,
      scenario: entry.scenario,
      daily: entry.daily ?? null,
      at: entry.at,
    },
  ];
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
  /** True when the landing of the current result was flown by hand in 3D. */
  readonly handFlown = signal(false);
  /** Past runs, newest first. */
  readonly history: Signal<MissionRun[]>;
  /**
   * A launched mission that has reached its destination and waits for the landing: the seed, the
   * story so far and the descent the player may fly. Null before launch and once the result is in.
   */
  readonly arrival = signal<{ seed: number; approach: MissionResult; plan: DescentPlan } | null>(null);

  /** The crew's shared room, or null when playing alone. */
  readonly room = signal<RoomState | null>(null);
  /** Players of the room that sit at this device (all of them on a shared screen). */
  readonly localPlayerIds = signal<string[]>([]);
  /** `local`: one shared screen. `online`: every player on their own device. */
  readonly roomKind = signal<'local' | 'online' | null>(null);
  readonly roomBusy = signal(false);
  readonly roomError = signal<string | null>(null);
  /** Roles this device may act for: all of them when playing alone. */
  readonly myRoles: ReadonlySignal<readonly RoleId[]>;
  /** True when more than one person is playing: events are then routed to roles during flight. */
  readonly crewed: ReadonlySignal<boolean>;
  /** The name this player last used, to prefill the crew screen. */
  readonly playerName = signal(load<string>(NAME_KEY) ?? '');

  readonly onlineAvailable: boolean;
  /** Set while a shared link or the daily mission fixes the seed of the next launch. */
  readonly challenge = signal<Challenge | null>(null);
  /** The global leaderboard as far as it has been loaded and verified. */
  readonly scores = signal<ScoresState>({ status: 'idle', entries: [] });
  /** True once the current result has been sent to the leaderboard. */
  readonly scoreSubmitted = signal(false);
  readonly leaderboardAvailable: boolean;
  private board: Promise<ScoreBoard> | null = null;

  private adapter: NetAdapter | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  /** The flight in progress: its seed, the design that launched and what the crew has put in. */
  private flight: { seed: number; design: MissionDesign; log: InputLog } | null = null;
  private readonly stopPersisting: () => void;
  private readonly onHashChange = (): void => {
    this.screen.value = this.guard(screenFromHash(location.hash));
  };

  constructor(
    initial: ScreenId,
    private readonly forecaster: Forecaster,
    private readonly online: OnlineAdapterFactory = null,
    private readonly boardFactory: ScoreBoardFactory = null,
  ) {
    this.onlineAvailable = online !== null;
    this.leaderboardAvailable = boardFactory !== null;
    const saved = load<MissionDesign>(DESIGN_KEY);
    this.design = signal(knownScenario(saved) ? saved : null);
    if (this.design.value) this.tier.value = this.design.value.tier;
    this.history = signal((load<MissionRun[]>(RUNS_KEY) ?? []).filter((run) => knownScenario(run.design)));
    this.evaluation = computed(() => (this.design.value ? evaluateDesign(this.design.value) : null));
    this.myRoles = computed(() => {
      const room = this.room.value;
      return room ? rolesOf(room, this.localPlayerIds.value) : ROLE_IDS;
    });
    this.crewed = computed(() => Object.keys(this.room.value?.players ?? {}).length > 1);
    this.screen = signal(this.guard(initial));
    // The hash is the source of truth for the screen, so browser Back and deep links just work.
    addEventListener('hashchange', this.onHashChange);
    this.stopPersisting = effect(() => {
      save(DESIGN_KEY, this.design.value);
      save(RUNS_KEY, this.history.value);
      save(NAME_KEY, this.playerName.value || null);
    });
  }

  /** Screens that need something that does not exist yet fall back to where it gets made. */
  private guard(screen: ScreenId): ScreenId {
    if (isMissionPhase(screen) && !this.design.value) return 'scenarios';
    if (screen === 'flight' && !this.result.value && !this.arrival.value) return 'poll';
    if (screen === 'debrief' && !this.result.value) return 'poll';
    if (screen === 'descent' && !this.arrival.value) return 'title';
    return screen;
  }

  navigate(screen: ScreenId): void {
    const hash = hashForScreen(this.guard(screen));
    if (location.hash === hash) this.screen.value = this.guard(screen);
    else location.hash = hash;
  }

  /** True when this device holds `role` (always, when playing alone). */
  holds(role: RoleId): boolean {
    return this.myRoles.value.includes(role);
  }

  /** Every design change goes through here: votes and forecasts describe the old design. */
  private commit(design: MissionDesign): void {
    const shared = this.room.value?.design ?? null;
    this.design.value = design;
    this.votes.value = emptyVotes();
    this.forecast.value = { status: 'idle' };
    this.adapter?.patch({ ...designPatch(shared, design), votes: emptyVotes() });
  }

  setTier(tier: TierId): void {
    if (!this.holds('director')) return;
    this.tier.value = tier;
    const design = this.design.value;
    if (design) this.commit({ ...design, tier });
  }

  /** Starts a fresh design for a scenario, or keeps the one in progress if it is the same scenario. */
  selectScenario(scenarioId: string): void {
    const current = this.design.value;
    if (!this.holds('director')) return;
    if (current?.scenarioId === scenarioId) this.commit({ ...current, tier: this.tier.value });
    else this.commit(createEmptyDesign(scenarioId, this.tier.value));
  }

  /** Puts a part in its slot (the slot is the part's category), or empties the slot with null. */
  setSlot(slot: SlotId, partId: string | null): void {
    const design = this.design.value;
    if (!design || !this.holds(roleForSlot(slot))) return;
    const slots = { ...design.slots };
    if (partId && findPart(partId)?.category === slot) slots[slot] = partId;
    else delete slots[slot];
    this.commit({ ...design, slots });
  }

  toggleInstrument(partId: string): void {
    const design = this.design.value;
    if (!design || !this.holds(roleForSlot('instrument'))) return;
    const instruments = design.instruments.includes(partId)
      ? design.instruments.filter((id) => id !== partId)
      : [...design.instruments, partId];
    this.commit({ ...design, instruments });
  }

  toggleRedundant(slot: SlotId): void {
    const design = this.design.value;
    if (!design || !this.holds(roleForSlot(slot))) return;
    const redundant = design.redundant.includes(slot)
      ? design.redundant.filter((id) => id !== slot)
      : [...design.redundant, slot];
    this.commit({ ...design, redundant });
  }

  setTrajectory(change: Partial<TrajectoryChoice>): void {
    const design = this.design.value;
    if (!design) return;
    if (!Object.keys(change).every((field) => this.holds(roleForTrajectoryField(field)))) return;
    this.commit({ ...design, trajectory: { ...design.trajectory, ...change } });
  }

  /** Replaces the whole design (loading a saved design, a mission code or a reference design). */
  loadDesign(design: MissionDesign): void {
    if (!this.holds('director')) return;
    this.tier.value = design.tier;
    this.commit(design);
  }

  setVote(role: RoleId, vote: Partial<RoleVote>): void {
    if (!this.holds(role)) return;
    const merged = { ...this.votes.value[role], ...vote };
    this.votes.value = { ...this.votes.value, [role]: merged };
    this.adapter?.patch({ [`votes.${role}`]: merged });
  }

  /** Calls Go for every role this device holds: all four for a single player. */
  voteAllGo(): void {
    const votes = { ...this.votes.value };
    const patch: RoomPatch = {};
    for (const role of this.myRoles.value) {
      votes[role] = { vote: 'go', reason: '' };
      patch[`votes.${role}`] = votes[role];
    }
    this.votes.value = votes;
    this.adapter?.patch(patch);
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
   * Launches with a fresh seed and opens the flight screen. Does nothing unless the poll has passed
   * and this device holds the Flight Director's role. A mission that survives to arrival stops
   * there for the landing to be flown by hand or handed to the guidance computer; one lost earlier
   * goes straight to its result. Pass a seed to replay a run.
   */
  launch(seed: number = this.challenge.value?.seed ?? newSeed()): void {
    const evaluation = this.evaluation.value;
    if (!evaluation || !pollOutcome(this.votes.value, evaluation).canLaunch) return;
    if (!this.holds('director')) return;
    if (this.adapter) {
      const flight: RoomFlight = { seed, landing: null, responses: {} };
      this.adapter.patch({ flight });
    } else this.beginFlight(seed);
  }

  private beginFlight(seed: number): void {
    const design = this.design.value;
    const evaluation = this.evaluation.value;
    if (!design || !evaluation?.launchable) return;
    const scripted = simulateMission(design, seed);
    const plan = planDescent(evaluation);
    this.flight = { seed, design, log: SCRIPTED_INPUT_LOG };
    this.result.value = null;
    this.handFlown.value = false;
    this.scoreSubmitted.value = false;
    if (scripted.lostIn === 'launch' || scripted.lostIn === 'cruise' || !plan) {
      this.arrival.value = null;
      this.finish(scripted);
    } else {
      this.arrival.value = { seed, approach: scripted, plan };
    }
    this.navigate('flight');
  }

  /** The guidance computer lands: the scripted result stands. The Spacecraft Engineer's call. */
  landAutomatically(): void {
    if (!this.arrival.value || !this.holds('engineer')) return;
    if (this.adapter) this.adapter.patch({ 'flight.landing': 'auto' });
    else this.resolveLanding('auto');
  }

  /** Takes the outcome of a hand-flown landing and lets the simulation decide the rest. */
  completeDescent(outcome: DescentOutcome): void {
    const arrival = this.arrival.value;
    const evaluation = this.evaluation.value;
    if (!arrival || !evaluation) return;
    const landing = landingInputFromDescent(arrival.plan, evaluation, outcome);
    if (this.adapter) this.adapter.patch({ 'flight.landing': landing });
    else this.resolveLanding(landing);
  }

  private resolveLanding(landing: LandingInput | 'auto'): void {
    const flight = this.flight;
    if (!this.arrival.value || !flight) return;
    this.arrival.value = null;
    this.handFlown.value = landing !== 'auto';
    flight.log = { ...flight.log, landing: landing === 'auto' ? null : landing };
    this.finish(simulateMission(flight.design, flight.seed, flight.log));
    this.navigate('flight');
  }

  /**
   * Records how long the responsible role took to acknowledge a routed event (crewed flights only).
   * `key` is the entry's index in the timeline.
   */
  acknowledge(key: string, seconds: number): void {
    this.adapter?.patch({ [`flight.responses.${key}`]: Math.round(seconds) });
  }

  /** Re-scores the flight once every routed event has an answer: coordination is part of the score. */
  private applyResponses(responses: Record<string, number>): void {
    const flight = this.flight;
    const result = this.result.value;
    const keys = Object.keys(responses);
    if (!flight || !result || keys.length === flight.log.eventResponses.length) return;
    flight.log = {
      ...flight.log,
      eventResponses: keys.sort().map((key) => ({
        eventId: result.timeline[Number(key)]?.title ?? key,
        responseSeconds: responses[key],
      })),
    };
    const rescored = simulateMission(flight.design, flight.seed, flight.log);
    this.result.value = rescored;
    const [latest, ...older] = this.history.value;
    if (latest?.seed === flight.seed) {
      this.history.value = [
        { ...latest, inputLog: flight.log, score: rescored.score.total, outcome: rescored.score.outcome },
        ...older,
      ];
    }
  }

  private finish(result: MissionResult): void {
    const flight = this.flight;
    if (!flight) return;
    this.result.value = result;
    const run: MissionRun = {
      id: (this.history.value[0]?.id ?? 0) + 1,
      at: Date.now(),
      seed: flight.seed,
      design: flight.design,
      inputLog: flight.log,
      score: result.score.total,
      outcome: result.score.outcome,
      headline: result.headline,
    };
    this.history.value = [run, ...this.history.value].slice(0, MAX_RUNS);
  }

  // ---------------------------------------------------------------- sharing and scores

  /** Loads the design of a mission code; a code that carries a seed also fixes the next launch to it. */
  openMissionCode(code: string): boolean {
    const mission = decodeMissionCode(code);
    if (!mission) return false;
    this.loadDesign(mission.design);
    this.challenge.value = mission.seed === null ? null : { seed: mission.seed, daily: null };
    return true;
  }

  /** A link that opens the flight just flown: same design, same seed, same luck. Null before a flight. */
  missionLink(): string | null {
    const flight = this.flight;
    if (!flight) return null;
    const code = encodeMissionCode({ design: flight.design, seed: flight.seed, inputLog: null });
    return `${location.origin}${location.pathname}?m=${code}`;
  }

  /** Today's mission: one scenario and one seed for everybody, changing at midnight UTC. */
  startDaily(now: number = Date.now()): void {
    if (!this.holds('director')) return;
    const daily = new Date(now).toISOString().slice(0, 10);
    const scenario = SCENARIOS[Math.floor(now / 86_400_000) % SCENARIOS.length];
    this.selectScenario(scenario.id);
    this.challenge.value = { seed: hashString(`daily:${daily}`), daily };
  }

  /** Back to a fresh seed on every launch. */
  clearChallenge(): void {
    this.challenge.value = null;
  }

  private openBoard(): Promise<ScoreBoard> | null {
    if (!this.boardFactory) return null;
    this.board ??= this.boardFactory();
    return this.board;
  }

  /** Fetches the leaderboard and keeps the entries whose score this client can reproduce. */
  loadScores(): void {
    const board = this.openBoard();
    if (!board || this.scores.value.status === 'loading') return;
    this.scores.value = { status: 'loading', entries: this.scores.value.entries };
    board
      .then((service) => service.top(BOARD_SIZE))
      .then(
        (entries) => {
          this.scores.value = { status: 'done', entries: entries.flatMap((entry) => verifyScore(entry)) };
        },
        (error: Error) => {
          // A board that failed to open is retried on the next request.
          this.board = null;
          this.scores.value = { status: 'failed', entries: [], error: error.message };
        },
      );
  }

  /** Sends the flight just flown to the leaderboard under `name`. */
  submitScore(name: string): void {
    const flight = this.flight;
    const result = this.result.value;
    const board = this.openBoard();
    if (!flight || !result || !board || !name.trim() || this.scoreSubmitted.value) return;
    this.playerName.value = name.trim();
    const challenge = this.challenge.value;
    const entry: ScoreEntry = {
      name: name.trim().slice(0, 20),
      score: result.score.total,
      scenario: flight.design.scenarioId,
      seed: flight.seed,
      daily: challenge?.seed === flight.seed ? challenge.daily : null,
      code: encodeMissionCode({ design: flight.design, seed: flight.seed, inputLog: flight.log }),
      at: Date.now(),
    };
    this.scoreSubmitted.value = true;
    board
      .then((service) => service.submit(entry))
      .then(
        () => this.loadScores(),
        (error: Error) => {
          this.scoreSubmitted.value = false;
          this.scores.value = { status: 'failed', entries: this.scores.value.entries, error: error.message };
        },
      );
  }

  // ---------------------------------------------------------------- crew

  /** Starts a crew on this one screen. The roles are dealt round the table. */
  startLocalRoom(names: readonly string[]): void {
    const players = names
      .map((name) => name.trim())
      .filter(Boolean)
      .slice(0, MAX_LOCAL_PLAYERS);
    if (players.length < 2) return;
    this.leaveRoom();
    const room = createRoom(TEXT.crew.localCode, this.design.value, Date.now());
    const ids = players.map((_, index) => `local-${index + 1}`);
    players.forEach((name, index) => {
      room.players[ids[index]] = { name, seenAt: Date.now() };
    });
    ROLE_IDS.forEach((role, index) => {
      room.roles[role] = ids[index % ids.length];
    });
    this.localPlayerIds.value = ids;
    this.attach(new MemoryAdapter());
    void this.adapter?.create(room);
  }

  /** Opens an online room and makes this player its Flight Director. */
  async createOnlineRoom(name: string): Promise<void> {
    await this.connect(name, async (adapter) => {
      const room = createRoom(newRoomCode(), this.design.value, Date.now());
      room.players[adapter.playerId] = { name, seenAt: Date.now() };
      room.roles.director = adapter.playerId;
      await adapter.create(room);
    });
  }

  async joinOnlineRoom(code: string, name: string): Promise<void> {
    await this.connect(name, async (adapter) => {
      if (!(await adapter.join(normaliseRoomCode(code)))) throw new Error(TEXT.crew.noSuchRoom);
      adapter.patch({ [`players.${adapter.playerId}`]: { name, seenAt: Date.now() } });
    });
  }

  private async connect(name: string, open: (adapter: NetAdapter) => Promise<void>): Promise<void> {
    if (!this.online || !name.trim() || this.roomBusy.value) return;
    this.leaveRoom();
    this.roomBusy.value = true;
    this.roomError.value = null;
    this.playerName.value = name.trim();
    try {
      const adapter = await this.online();
      this.localPlayerIds.value = [adapter.playerId];
      this.attach(adapter);
      await open(adapter);
      this.heartbeat = setInterval(() => {
        adapter.patch({ [`players.${adapter.playerId}.seenAt`]: Date.now() });
      }, HEARTBEAT_MS);
    } catch (error) {
      this.leaveRoom();
      this.roomError.value = error instanceof Error ? error.message : String(error);
    } finally {
      this.roomBusy.value = false;
    }
  }

  private attach(adapter: NetAdapter): void {
    this.adapter = adapter;
    this.roomKind.value = adapter.kind;
    adapter.onChange((room) => this.applyRoom(room));
    adapter.onError((message) => {
      this.roomError.value = message;
    });
  }

  /** Back to playing alone; the design stays as it was. */
  leaveRoom(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    this.adapter?.dispose();
    this.adapter = null;
    this.room.value = null;
    this.roomKind.value = null;
    this.localPlayerIds.value = [];
  }

  /** Gives `role` to a player of the room, or to nobody (then everyone may act for it). */
  assignRole(role: RoleId, playerId: string | null): void {
    this.adapter?.patch({ [`roles.${role}`]: playerId });
  }

  /** One role asks another for something ("Science asks Engineering for 4 kg"). */
  sendRequest(from: RoleId, to: RoleId, text: string): void {
    if (!text.trim() || !this.holds(from)) return;
    const id = `${Date.now()}-${newSeed().toString(36)}`;
    this.adapter?.patch({
      [`requests.${id}`]: { from, to, text: text.trim(), at: Date.now(), status: 'open' },
    });
  }

  answerRequest(id: string, status: 'accepted' | 'declined'): void {
    const request = this.room.value?.requests[id];
    if (!request || !this.holds(request.to)) return;
    this.adapter?.patch({ [`requests.${id}.status`]: status });
  }

  /** Brings this device in line with the room after any change, its own included. */
  private applyRoom(room: RoomState): void {
    this.room.value = room;
    if (room.design && knownScenario(room.design) && !sameData(room.design, this.design.value)) {
      this.design.value = room.design;
      this.tier.value = room.design.tier;
      this.forecast.value = { status: 'idle' };
    }
    if (!sameData(room.votes, this.votes.value)) this.votes.value = room.votes;
    const flight = room.flight;
    if (!flight) return;
    if (flight.seed !== this.flight?.seed) this.beginFlight(flight.seed);
    if (flight.landing !== null && this.arrival.value?.seed === flight.seed) {
      this.resolveLanding(flight.landing);
    }
    if (this.result.value?.seed === flight.seed) this.applyResponses(flight.responses ?? {});
  }

  dispose(): void {
    this.leaveRoom();
    void this.board?.then((service) => service.dispose());
    removeEventListener('hashchange', this.onHashChange);
    this.stopPersisting();
  }
}
