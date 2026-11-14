/**
 * The online service as this build was configured. The Firebase web config comes from `VITE_*`
 * variables (public by design: access is controlled by the database rules); without them the game
 * plays offline with a shared-screen crew and a local leaderboard.
 */
import type { FirebaseWebConfig } from '@/coop/firebase-adapter';
import type { NetAdapter } from '@/coop/net-adapter';
import type { ScoreBoard } from '@/coop/score-board';

function webConfig(): FirebaseWebConfig | null {
  const env = import.meta.env;
  const config = {
    apiKey: env.VITE_FIREBASE_API_KEY as string | undefined,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
    projectId: env.VITE_FIREBASE_PROJECT_ID as string | undefined,
    appId: env.VITE_FIREBASE_APP_ID as string | undefined,
  };
  if (!config.apiKey || !config.authDomain || !config.projectId || !config.appId) return null;
  return config as FirebaseWebConfig;
}

/** Opens an online adapter, or null when this build has no online configuration. */
export function onlineAdapterFactory(): (() => Promise<NetAdapter>) | null {
  const config = webConfig();
  if (!config) return null;
  // The SDK is a separate chunk: nobody who plays alone downloads it.
  return async () => (await import('@/coop/firebase-adapter')).FirebaseAdapter.connect(config);
}

/** Opens the global leaderboard, or null when this build has no online configuration. */
export function scoreBoardFactory(): (() => Promise<ScoreBoard>) | null {
  const config = webConfig();
  if (!config) return null;
  return async () => (await import('@/coop/firebase-scores')).FirebaseScoreBoard.connect(config);
}
