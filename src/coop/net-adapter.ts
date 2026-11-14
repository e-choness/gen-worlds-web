// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
/**
 * Everything co-op needs from a network, behind one interface. The in-memory adapter serves a crew
 * on one shared screen and any device without a connection; the Firebase adapter serves a crew on
 * their own devices. The game never talks to a network any other way.
 */

import type { RoomPatch, RoomState } from '@/coop/room';
import type { Disposable } from '@/core/disposable';

export interface NetAdapter extends Disposable {
  /** `local`: one shared screen. `online`: each player on their own device. */
  readonly kind: 'local' | 'online';
  /** Identifies this device's player in `RoomState.players`. */
  readonly playerId: string;
  /** Creates the room and starts listening to it. Rejects when the code is taken. */
  create(room: RoomState): Promise<void>;
  /** Starts listening to an existing room. Resolves false when there is no such room. */
  join(code: string): Promise<boolean>;
  /** Called with the whole room after every change, the local ones included. */
  onChange(listener: (room: RoomState) => void): void;
  /** Called when the connection fails; the message is shown to the player. */
  onError(listener: (message: string) => void): void;
  /** Changes fields of the room. Local changes reach `onChange` without waiting for the network. */
  patch(patch: RoomPatch): void;
}
