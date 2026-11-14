// Gen Worlds © 2026 Echo Yin. Licensed under Apache-2.0: see LICENSE.md.
/** The leaderboard on Firestore: one document per flight in `scores`, written once and never changed. */
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import {
  addDoc,
  collection,
  type Firestore,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
} from 'firebase/firestore';
import { answered, type FirebaseWebConfig } from '@/coop/firebase-adapter';
import type { ScoreBoard, ScoreEntry } from '@/coop/score-board';

const SCORES = 'scores';

export class FirebaseScoreBoard implements ScoreBoard {
  private constructor(
    private readonly database: Firestore,
    private readonly uid: string,
  ) {}

  static async connect(config: FirebaseWebConfig): Promise<FirebaseScoreBoard> {
    const app = initializeApp(config, `gen-worlds-scores-${Date.now()}`);
    const credential = await answered(signInAnonymously(getAuth(app)));
    return new FirebaseScoreBoard(getFirestore(app), credential.user.uid);
  }

  async submit(entry: ScoreEntry): Promise<void> {
    await answered(addDoc(collection(this.database, SCORES), { ...entry, uid: this.uid }));
  }

  async top(count: number): Promise<ScoreEntry[]> {
    // Ordered by score only: filtering by scenario happens in the client, so no composite index is needed.
    const snapshot = await answered(
      getDocs(query(collection(this.database, SCORES), orderBy('score', 'desc'), limit(count))),
    );
    return snapshot.docs.map((entry) => entry.data() as ScoreEntry);
  }

  dispose(): void {
    // The SDK keeps no listener open for one-off reads and writes.
  }
}
