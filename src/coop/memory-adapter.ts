// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
import type { NetAdapter } from '@/coop/net-adapter';
import { applyPatch, type RoomPatch, type RoomState } from '@/coop/room';

/** A room that lives in this tab: a crew around one screen, or any device that is offline. */
export class MemoryAdapter implements NetAdapter {
  readonly kind = 'local';
  readonly playerId = 'local-1';
  private room: RoomState | null = null;
  private listener: ((room: RoomState) => void) | null = null;

  create(room: RoomState): Promise<void> {
    this.room = room;
    this.listener?.(room);
    return Promise.resolve();
  }

  /** There is nothing to join: an in-memory room exists only where it was created. */
  join(): Promise<boolean> {
    return Promise.resolve(false);
  }

  onChange(listener: (room: RoomState) => void): void {
    this.listener = listener;
    if (this.room) listener(this.room);
  }

  onError(): void {
    // Nothing here can fail.
  }

  patch(patch: RoomPatch): void {
    if (!this.room) return;
    this.room = applyPatch(this.room, patch);
    this.listener?.(this.room);
  }

  dispose(): void {
    this.listener = null;
    this.room = null;
  }
}
