/**
 * Online rooms on Firestore with anonymous sign-in. One document per room (`rooms/{code}`), changed
 * by field updates so players editing different things merge; one write per decision, never per
 * frame. The Firebase SDK is only loaded when a player goes online (this module is imported lazily).
 */
import { type FirebaseApp, initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';
import {
  type DocumentReference,
  deleteField,
  doc,
  type Firestore,
  getDoc,
  getFirestore,
  onSnapshot,
  setDoc,
  type Unsubscribe,
  updateDoc,
} from 'firebase/firestore';
import type { NetAdapter } from '@/coop/net-adapter';
import { REMOVE, type RoomPatch, type RoomState } from '@/coop/room';

export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
}

const ROOMS = 'rooms';
/** Firestore retries a refused connection for ever; past this the player is told instead, ms. */
const ANSWER_TIMEOUT_MS = 12_000;

/** Rejects when the service has not answered in time, so a dead backend shows as an error. */
export function answered<T>(request: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(
            'The online service did not answer. Check the connection, or play around one screen instead.',
          ),
        ),
      ANSWER_TIMEOUT_MS,
    );
    request.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Firestore rejects `undefined`: a JSON round trip drops such fields from plain data. */
function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class FirebaseAdapter implements NetAdapter {
  readonly kind = 'online';
  private room: DocumentReference | null = null;
  private stop: Unsubscribe | null = null;
  private listener: ((room: RoomState) => void) | null = null;
  private errorListener: ((message: string) => void) | null = null;

  private constructor(
    private readonly database: Firestore,
    readonly playerId: string,
  ) {}

  /** Signs in anonymously and returns an adapter ready to create or join a room. */
  static async connect(config: FirebaseWebConfig): Promise<FirebaseAdapter> {
    const app: FirebaseApp = initializeApp(config, `gen-worlds-${Date.now()}`);
    const credential = await answered(signInAnonymously(getAuth(app)));
    return new FirebaseAdapter(getFirestore(app), credential.user.uid);
  }

  async create(room: RoomState): Promise<void> {
    const reference = doc(this.database, ROOMS, room.code);
    if ((await answered(getDoc(reference))).exists())
      throw new Error('That room code is already in use. Try again.');
    await answered(setDoc(reference, plain(room)));
    this.listen(reference);
  }

  async join(code: string): Promise<boolean> {
    if (!code) return false;
    const reference = doc(this.database, ROOMS, code);
    if (!(await answered(getDoc(reference))).exists()) return false;
    this.listen(reference);
    return true;
  }

  private listen(reference: DocumentReference): void {
    this.room = reference;
    this.stop = onSnapshot(
      reference,
      (snapshot) => {
        const data = snapshot.data();
        if (data) this.listener?.(data as RoomState);
      },
      (error) => this.errorListener?.(error.message),
    );
  }

  onChange(listener: (room: RoomState) => void): void {
    this.listener = listener;
  }

  onError(listener: (message: string) => void): void {
    this.errorListener = listener;
  }

  patch(patch: RoomPatch): void {
    if (!this.room) return;
    const update: Record<string, unknown> = {};
    for (const [path, value] of Object.entries(patch)) {
      update[path] = value === REMOVE ? deleteField() : plain(value);
    }
    // The snapshot listener sees the change at once; only a failure needs reporting.
    updateDoc(this.room, update).catch((error: Error) => this.errorListener?.(error.message));
  }

  dispose(): void {
    this.stop?.();
    this.stop = null;
    this.room = null;
    this.listener = null;
    this.errorListener = null;
  }
}
