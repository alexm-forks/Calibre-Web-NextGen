// The app's one position outbox, and when it is flushed.
//
// Firefox has no Background Sync API, so pending positions are sent while the
// app is open: at start, when the browser reports it is back online, when the
// app returns to the foreground, and every minute while visible and pending.
import { ApiError, apiPost } from '../api';
import { readerBookmarkBody } from '../readerBookmark';
import { createIdbStore, openOfflineDb } from './idbStore';
import {
  createMemoryStore, createPositionOutbox, type OutboxStore, type PendingPosition,
  type PositionOutbox, type SendResult,
} from './positionOutbox';

const RETRY_INTERVAL_MS = 60_000;

/** One send of a pending position. `auth: 'public'` so a 401 here keeps the
 * position queued instead of starting the app-wide sign-out (api.ts
 * classifiedFetch): losing the session must never cost unsent reading. */
export async function sendPendingPosition(position: PendingPosition): Promise<SendResult> {
  try {
    await apiPost(
      `/api/v1/books/${position.bookId}/bookmark`,
      readerBookmarkBody(position.bookmark, position.percentage, position.shareWithDevices,
        position.observedAt),
      { auth: 'public' },
    );
    return 'sent';
  } catch (error) {
    if (!(error instanceof ApiError)) return 'retry'; // offline / transport
    if (error.status === 401) return 'auth';
    if (error.status >= 500 || error.status === 408 || error.status === 429) return 'retry';
    return 'drop';
  }
}

function openStore(): OutboxStore {
  if (typeof indexedDB === 'undefined') return createMemoryStore();
  const db = openOfflineDb();
  const durable = createIdbStore(db);
  const fallback = createMemoryStore();
  // Private modes can refuse IndexedDB. Positions then live only as long as
  // the page, which is still better than failing the save.
  const usable = db.then(() => true, (err: unknown) => {
    console.warn('CWNG: offline storage unavailable; unsent positions will not survive a reload', err);
    return false;
  });
  const pick = async () => ((await usable) ? durable : fallback);
  return {
    all: async () => (await pick()).all(),
    get: async key => (await pick()).get(key),
    putIfNewer: async position => (await pick()).putIfNewer(position),
    removeIfNotNewer: async (key, observedAt) => (await pick()).removeIfNotNewer(key, observedAt),
  };
}

let outbox: PositionOutbox | null = null;

export function positionOutbox(): PositionOutbox {
  if (!outbox) outbox = createPositionOutbox(openStore(), sendPendingPosition);
  return outbox;
}

let started = false;

/** Begin flushing pending positions whenever there is a chance to. Idempotent. */
export function startPositionSync(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  const flush = () => {
    if (navigator.onLine === false) return;
    positionOutbox().flush().catch((err: unknown) => {
      console.warn('CWNG: sending saved reading positions failed', err);
    });
  };
  flush();
  window.addEventListener('online', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') flush();
  });
  window.setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    positionOutbox().pending().then(rows => {
      if (rows.length) flush();
    }, () => {});
  }, RETRY_INTERVAL_MS);
}
