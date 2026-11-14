import { MISSION_PHASES, type MissionPhase } from '@/mission/phases';

/** Every full-screen destination. The URL hash mirrors it (`#/design`) so Back and deep links work. */
export type ScreenId = 'title' | 'scenarios' | MissionPhase | 'sandbox';

const SCREEN_IDS: readonly ScreenId[] = ['title', 'scenarios', ...MISSION_PHASES, 'sandbox'];

export function isMissionPhase(screen: ScreenId): screen is MissionPhase {
  return (MISSION_PHASES as readonly string[]).includes(screen);
}

/** Unknown or empty hashes fall back to the title screen rather than a blank page. */
export function screenFromHash(hash: string): ScreenId {
  const id = hash.replace(/^#\/?/, '');
  return (SCREEN_IDS as readonly string[]).includes(id) ? (id as ScreenId) : 'title';
}

export function hashForScreen(screen: ScreenId): string {
  return screen === 'title' ? '#/' : `#/${screen}`;
}
