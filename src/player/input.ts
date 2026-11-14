// Gen Worlds © 2026 Echo Yin. PolyForm Noncommercial 1.0.0: see LICENSE.md.
import { type Disposable, DisposableStore } from '@/core/disposable';

/**
 * Keyboard / mouse state sampled by controllers once per frame. Uses `KeyboardEvent.code` so the
 * bindings are layout-independent.
 */
export class Input implements Disposable {
  private readonly keys = new Set<string>();
  private readonly pressed = new Set<string>();
  private readonly store = new DisposableStore();
  private dx = 0;
  private dy = 0;
  private wheel = 0;

  constructor(private readonly element: HTMLElement) {
    this.store.listen(window, 'keydown', (e) => {
      if (isTyping(e.target)) return;
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    });
    this.store.listen(window, 'keyup', (e) => this.keys.delete(e.code));
    this.store.listen(window, 'blur', () => this.keys.clear());
    this.store.listen(document, 'mousemove', (e) => {
      if (!this.locked) return;
      this.dx += e.movementX;
      this.dy += e.movementY;
    });
    this.store.listen(
      element,
      'wheel',
      (e) => {
        this.wheel += Math.sign(e.deltaY);
        e.preventDefault();
      },
      { passive: false },
    );
    this.store.listen(element, 'mousedown', (e) => {
      if (e.button === 0 && !this.locked) this.lock();
      this.keys.add(`Mouse${e.button}`);
      this.pressed.add(`Mouse${e.button}`);
    });
    this.store.listen(window, 'mouseup', (e) => this.keys.delete(`Mouse${e.button}`));
    this.store.listen(element, 'contextmenu', (e) => e.preventDefault());
  }

  get locked(): boolean {
    return document.pointerLockElement === this.element;
  }

  lock(): void {
    // Rejects when the document is not focused or the gesture is too old: harmless.
    this.element.requestPointerLock()?.catch?.(() => {});
  }

  unlock(): void {
    if (this.locked) document.exitPointerLock();
  }

  down(code: string): boolean {
    return this.keys.has(code);
  }

  /** True only on the frame the key went down. */
  justPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  /** +1 / 0 / -1 from a pair of keys. */
  axis(positive: string, negative: string): number {
    return (this.keys.has(positive) ? 1 : 0) - (this.keys.has(negative) ? 1 : 0);
  }

  /** Returns and clears the accumulated mouse motion. */
  consumeMouse(): { dx: number; dy: number; wheel: number } {
    const out = { dx: this.dx, dy: this.dy, wheel: this.wheel };
    this.dx = 0;
    this.dy = 0;
    this.wheel = 0;
    return out;
  }

  /** Call at the end of each frame. */
  endFrame(): void {
    this.pressed.clear();
  }

  dispose(): void {
    this.unlock();
    this.store.dispose();
  }
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}
