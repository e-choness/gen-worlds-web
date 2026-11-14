/**
 * The one game-state store. Screens read its signals and ask for changes through its methods; they
 * never write the signals themselves.
 */
import { computed, effect, type ReadonlySignal, type Signal, signal } from '@preact/signals';
import type { Disposable } from '@/core/disposable';
import type { TierId } from '@/data/mission-constants';
import { findPart, type SlotId } from '@/data/parts';
import { SCENARIOS } from '@/data/scenarios';
import { createEmptyDesign, type MissionDesign, type TrajectoryChoice } from '@/mission/design';
import { type DesignEvaluation, evaluateDesign } from '@/mission/evaluate-design';
import { hashForScreen, isMissionPhase, type ScreenId, screenFromHash } from '@/ui/screen-id';

/** 'checking' until the adapter request settles; the 3D paths stay closed unless 'available'. */
export type WebgpuSupport = 'checking' | 'available' | 'unavailable';

const DESIGN_KEY = 'gen-worlds.design.v1';

function loadDesign(): MissionDesign | null {
  try {
    const saved = JSON.parse(localStorage.getItem(DESIGN_KEY) ?? 'null') as MissionDesign | null;
    // A design from an older build may name a scenario that no longer exists.
    return saved && SCENARIOS.some((scenario) => scenario.id === saved.scenarioId) ? saved : null;
  } catch {
    return null;
  }
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

  private readonly stopPersisting: () => void;
  private readonly onHashChange = (): void => {
    this.screen.value = this.guard(screenFromHash(location.hash));
  };

  constructor(initial: ScreenId = screenFromHash(location.hash)) {
    this.design = signal(loadDesign());
    if (this.design.value) this.tier.value = this.design.value.tier;
    this.evaluation = computed(() => (this.design.value ? evaluateDesign(this.design.value) : null));
    this.screen = signal(this.guard(initial));
    // The hash is the source of truth for the screen, so browser Back and deep links just work.
    addEventListener('hashchange', this.onHashChange);
    this.stopPersisting = effect(() => {
      const design = this.design.value;
      try {
        if (design) localStorage.setItem(DESIGN_KEY, JSON.stringify(design));
        else localStorage.removeItem(DESIGN_KEY);
      } catch {
        // Storage can be blocked (private mode): the game still plays, it just forgets on reload.
      }
    });
  }

  /** Mission phases need a design: without one, a deep link falls back to the scenario screen. */
  private guard(screen: ScreenId): ScreenId {
    return isMissionPhase(screen) && !this.design.value ? 'scenarios' : screen;
  }

  navigate(screen: ScreenId): void {
    const hash = hashForScreen(this.guard(screen));
    if (location.hash === hash) this.screen.value = this.guard(screen);
    else location.hash = hash;
  }

  setTier(tier: TierId): void {
    this.tier.value = tier;
    const design = this.design.value;
    if (design) this.design.value = { ...design, tier };
  }

  /** Starts a fresh design for a scenario, or keeps the one in progress if it is the same scenario. */
  selectScenario(scenarioId: string): void {
    const current = this.design.value;
    if (current?.scenarioId === scenarioId) this.design.value = { ...current, tier: this.tier.value };
    else this.design.value = createEmptyDesign(scenarioId, this.tier.value);
  }

  /** Puts a part in its slot (the slot is the part's category), or empties the slot with null. */
  setSlot(slot: SlotId, partId: string | null): void {
    const design = this.design.value;
    if (!design) return;
    const slots = { ...design.slots };
    if (partId && findPart(partId)?.category === slot) slots[slot] = partId;
    else delete slots[slot];
    this.design.value = { ...design, slots };
  }

  toggleInstrument(partId: string): void {
    const design = this.design.value;
    if (!design) return;
    const instruments = design.instruments.includes(partId)
      ? design.instruments.filter((id) => id !== partId)
      : [...design.instruments, partId];
    this.design.value = { ...design, instruments };
  }

  toggleRedundant(slot: SlotId): void {
    const design = this.design.value;
    if (!design) return;
    const redundant = design.redundant.includes(slot)
      ? design.redundant.filter((id) => id !== slot)
      : [...design.redundant, slot];
    this.design.value = { ...design, redundant };
  }

  setTrajectory(change: Partial<TrajectoryChoice>): void {
    const design = this.design.value;
    if (!design) return;
    this.design.value = { ...design, trajectory: { ...design.trajectory, ...change } };
  }

  /** Replaces the whole design (loading a saved design, a mission code or a reference design). */
  loadDesign(design: MissionDesign): void {
    this.tier.value = design.tier;
    this.design.value = design;
  }

  dispose(): void {
    removeEventListener('hashchange', this.onHashChange);
    this.stopPersisting();
  }
}
