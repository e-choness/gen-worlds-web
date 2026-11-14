/**
 * The one game-state store. Screens read its signals and ask for changes through its methods; they
 * never write the signals themselves.
 */
import { type Signal, signal } from '@preact/signals';
import type { Disposable } from '@/core/disposable';
import { hashForScreen, type ScreenId, screenFromHash } from '@/ui/screen-id';

/** 'checking' until the adapter request settles; the 3D paths stay closed unless 'available'. */
export type WebgpuSupport = 'checking' | 'available' | 'unavailable';

export class GameStore implements Disposable {
  readonly screen: Signal<ScreenId>;
  readonly webgpu = signal<WebgpuSupport>('checking');
  /** Set when the 3D engine failed to start; shown verbatim on the sandbox screen. */
  readonly engineError = signal<string | null>(null);

  private readonly onHashChange = (): void => {
    this.screen.value = screenFromHash(location.hash);
  };

  constructor(initial: ScreenId = screenFromHash(location.hash)) {
    this.screen = signal(initial);
    // The hash is the source of truth for the screen, so browser Back and deep links just work.
    addEventListener('hashchange', this.onHashChange);
  }

  navigate(screen: ScreenId): void {
    const hash = hashForScreen(screen);
    if (location.hash === hash) this.screen.value = screen;
    else location.hash = hash;
  }

  dispose(): void {
    removeEventListener('hashchange', this.onHashChange);
  }
}
