/**
 * Ownership primitives. Every GPU-backed or event-bound object in the app is owned by exactly one
 * `DisposableStore`; tearing down the owner tears down everything it created, in reverse order.
 */
export interface Disposable {
  dispose(): void;
}

export class DisposableStore implements Disposable {
  private items: Disposable[] = [];
  private disposed = false;

  /** Registers `item` and returns it, so creation and ownership read as one expression. */
  add<T extends Disposable>(item: T): T {
    if (this.disposed) {
      item.dispose();
      throw new Error('DisposableStore: add() after dispose()');
    }
    this.items.push(item);
    return item;
  }

  /** Registers an arbitrary teardown callback. */
  defer(fn: () => void): void {
    this.add({ dispose: fn });
  }

  /** Subscribes to a DOM event and unsubscribes on dispose. */
  listen<K extends keyof WindowEventMap>(
    target: Window,
    type: K,
    handler: (e: WindowEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ): void;
  listen<K extends keyof DocumentEventMap>(
    target: Document,
    type: K,
    handler: (e: DocumentEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ): void;
  listen<K extends keyof HTMLElementEventMap>(
    target: HTMLElement,
    type: K,
    handler: (e: HTMLElementEventMap[K]) => void,
    options?: AddEventListenerOptions,
  ): void;
  listen(
    target: EventTarget,
    type: string,
    handler: (e: never) => void,
    options?: AddEventListenerOptions,
  ): void {
    target.addEventListener(type, handler as EventListener, options);
    this.defer(() => target.removeEventListener(type, handler as EventListener, options));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (let i = this.items.length - 1; i >= 0; i--) {
      try {
        this.items[i].dispose();
      } catch (err) {
        console.error('[dispose]', err);
      }
    }
    this.items.length = 0;
  }
}
