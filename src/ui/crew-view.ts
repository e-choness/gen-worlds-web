// Gen Worlds © 2026 Echo Yin. PolyForm Noncommercial 1.0.0: see LICENSE.md.
/**
 * What the screens need to know about the crew, as plain props. The shell builds it from the room;
 * the screens never see the room or the network.
 */
import { MISSION_CONSTANTS, type RoleId } from '@/data/mission-constants';
import { TEXT } from '@/ui/text';

export interface CrewPlayer {
  id: string;
  name: string;
  /** True for players at this device. */
  here: boolean;
}

export interface CrewRequest {
  id: string;
  from: RoleId;
  to: RoleId;
  text: string;
  status: 'open' | 'accepted' | 'declined';
}

export interface CrewView {
  /** `local`: one shared screen. `online`: every player on their own device. */
  kind: 'local' | 'online';
  code: string;
  players: CrewPlayer[];
  /** Player id holding each role, or null when nobody does. */
  holders: Record<RoleId, string | null>;
  /** Roles this device may act for. */
  mine: readonly RoleId[];
  requests: CrewRequest[];
}

export function roleName(role: RoleId): string {
  return MISSION_CONSTANTS.roles.find((entry) => entry.id === role)?.name ?? role;
}

/** "Spacecraft Engineer (Sam)", or just the role when nobody holds it. */
export function roleWithHolder(crew: CrewView | null, role: RoleId): string {
  const holder = crew?.players.find((player) => player.id === crew.holders[role]);
  return holder ? `${roleName(role)} (${holder.name})` : roleName(role);
}

/** True when this device may act for `role`: always when playing alone. */
export function mayAct(crew: CrewView | null, role: RoleId): boolean {
  return !crew || crew.mine.includes(role);
}

/** The line shown where a control belongs to another player. */
export function ownedBy(crew: CrewView | null, role: RoleId): string {
  return `${TEXT.crew.ownedBy} ${roleWithHolder(crew, role)}. ${TEXT.crew.askThem}`;
}
