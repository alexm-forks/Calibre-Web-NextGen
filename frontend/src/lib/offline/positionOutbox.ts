// Reading positions that have not reached the server yet.
//
// Every save is written here before it is sent and removed once the server has
// it, so a position read offline, or on a connection that drops mid-request,
// or in a tab closed before the request finished, is sent the next time the
// app is online (positionSync.ts). Reader-agnostic: a position is an opaque
// locator string (an epub.js CFI today) plus the portable percentage.
//
// Only the newest position per book is kept. Each carries `observedAt`, when
// the reader was there; the server orders saves by it (cps/api/reader.py), so
// a save that arrives hours late neither replaces a newer place nor loses to
// an older one, and sending the same save twice is harmless.
//
// No DOM or browser imports: storage and transport are injected, which keeps
// this file testable under node (frontend/unit/positionOutbox.test.ts).

export interface PendingPosition {
  bookId: number;
  format: string;
  /** The reader's own locator (epub.js CFI). */
  bookmark: string;
  /** 0-100, when the reader could compute one. */
  percentage?: number;
  shareWithDevices: boolean;
  /** ISO-8601 UTC: when the reader was at this place. */
  observedAt: string;
}

export interface OutboxStore {
  all(): Promise<PendingPosition[]>;
  get(key: string): Promise<PendingPosition | undefined>;
  /** Store `position` unless the stored entry for its key is newer. */
  putIfNewer(position: PendingPosition): Promise<boolean>;
  /** Remove the entry for `key` if it is not newer than `observedAt`. */
  removeIfNotNewer(key: string, observedAt: string): Promise<void>;
}

/** What the transport made of one send. */
export type SendResult =
  | 'sent' // the server has it (or already had it)
  | 'retry' // offline, timed out or a server error: keep it, try later
  | 'auth' // signed out: keep it, and stop until the user signs in again
  | 'drop'; // refused for good (e.g. the book is gone): sending again can't help

export type Sender = (position: PendingPosition) => Promise<SendResult>;

export interface FlushResult {
  sent: number;
  dropped: number;
  remaining: number;
  needsSignIn: boolean;
}

export function outboxKey(bookId: number, format: string): string {
  return `${bookId}:${format.toLowerCase()}`;
}

export function isNewer(a: string, b: string): boolean {
  return Date.parse(a) > Date.parse(b);
}

export function createPositionOutbox(store: OutboxStore, send: Sender) {
  let flushing: Promise<FlushResult> | null = null;

  async function record(position: PendingPosition): Promise<void> {
    await store.putIfNewer(position);
  }

  /** The server has the save made at `observedAt`; forget it (and anything older). */
  async function settle(bookId: number, format: string, observedAt: string): Promise<void> {
    await store.removeIfNotNewer(outboxKey(bookId, format), observedAt);
  }

  async function pending(bookId?: number, format = 'epub'): Promise<PendingPosition[]> {
    if (bookId === undefined) return store.all();
    const one = await store.get(outboxKey(bookId, format));
    return one ? [one] : [];
  }

  async function runFlush(): Promise<FlushResult> {
    const result: FlushResult = { sent: 0, dropped: 0, remaining: 0, needsSignIn: false };
    const queue = (await store.all())
      .sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
    for (let i = 0; i < queue.length; i++) {
      const position = queue[i];
      let outcome: SendResult;
      try {
        outcome = await send(position);
      } catch {
        outcome = 'retry';
      }
      if (outcome === 'sent' || outcome === 'drop') {
        // A newer position recorded while this one was in flight survives.
        await store.removeIfNotNewer(outboxKey(position.bookId, position.format), position.observedAt);
        if (outcome === 'sent') result.sent += 1;
        else result.dropped += 1;
        continue;
      }
      // Offline or signed out: the rest would fail the same way. Keep them all.
      result.needsSignIn = outcome === 'auth';
      result.remaining = queue.length - i;
      return result;
    }
    result.remaining = (await store.all()).length;
    return result;
  }

  /** Send everything pending, oldest first. One flush at a time. */
  function flush(): Promise<FlushResult> {
    if (!flushing) {
      flushing = runFlush().finally(() => {
        flushing = null;
      });
    }
    return flushing;
  }

  return { record, settle, pending, flush };
}

export type PositionOutbox = ReturnType<typeof createPositionOutbox>;

/** In-memory store: the fallback when IndexedDB is unavailable (some private
 * modes), and the store the unit tests use. */
export function createMemoryStore(): OutboxStore {
  const rows = new Map<string, PendingPosition>();
  return {
    async all() {
      return [...rows.values()].map(row => ({ ...row }));
    },
    async get(key) {
      const row = rows.get(key);
      return row ? { ...row } : undefined;
    },
    async putIfNewer(position) {
      const key = outboxKey(position.bookId, position.format);
      const current = rows.get(key);
      if (current && !isNewer(position.observedAt, current.observedAt)
        && current.observedAt !== position.observedAt) return false;
      rows.set(key, { ...position });
      return true;
    },
    async removeIfNotNewer(key, observedAt) {
      const current = rows.get(key);
      if (current && !isNewer(current.observedAt, observedAt)) rows.delete(key);
    },
  };
}
