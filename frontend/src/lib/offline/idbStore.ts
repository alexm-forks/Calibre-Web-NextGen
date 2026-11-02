// IndexedDB storage for the position outbox. Survives reloads, tab closes and
// the installed app being killed, which is the point: a position read offline
// must still be there when the connection comes back.
//
// Each compare-and-write happens inside one readwrite transaction, so two tabs
// recording the same book cannot interleave a stale overwrite.
import {
  isNewer, outboxKey, type OutboxStore, type PendingPosition,
} from './positionOutbox.ts';

const DB_NAME = 'cwng-offline';
// v1: positions (the outbox). v2: books (downloaded for offline reading) and
// places (the last place reached in each book on this device).
const DB_VERSION = 2;
const POSITIONS = 'positions';
export const BOOKS = 'books';
export const PLACES = 'places';

interface Row extends PendingPosition { key: string }

export function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
    tx.onerror = () => reject(tx.error);
  });
}

let shared: Promise<IDBDatabase> | null = null;

/** One connection per page; a failed open is retried on the next call. */
export function openOfflineDb(): Promise<IDBDatabase> {
  if (!shared) {
    shared = openOnce();
    shared.catch(() => { shared = null; });
  }
  return shared;
}

function openOnce(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(POSITIONS)) {
        db.createObjectStore(POSITIONS, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(BOOKS)) {
        db.createObjectStore(BOOKS, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(PLACES)) {
        db.createObjectStore(PLACES, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // Another tab upgrading the schema: let it, and reopen next time.
      db.onversionchange = () => { db.close(); shared = null; };
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('cwng-offline database upgrade blocked'));
  });
}

function strip(row: Row): PendingPosition {
  const { key: _key, ...position } = row;
  return position;
}

export function createIdbStore(openDb: () => Promise<IDBDatabase> = openOfflineDb): OutboxStore {
  return {
    async all() {
      const db = await openDb();
      const rows = await promisify(db.transaction(POSITIONS).objectStore(POSITIONS).getAll());
      return (rows as Row[]).map(strip);
    },
    async get(key) {
      const db = await openDb();
      const row = await promisify(db.transaction(POSITIONS).objectStore(POSITIONS).get(key));
      return row ? strip(row as Row) : undefined;
    },
    async putIfNewer(position) {
      const db = await openDb();
      const tx = db.transaction(POSITIONS, 'readwrite');
      const store = tx.objectStore(POSITIONS);
      const key = outboxKey(position.bookId, position.format);
      let written = false;
      const current = await promisify(store.get(key)) as Row | undefined;
      if (!current || isNewer(position.observedAt, current.observedAt)
        || current.observedAt === position.observedAt) {
        store.put({ ...position, key });
        written = true;
      }
      await done(tx);
      return written;
    },
    async removeIfNotNewer(key, observedAt) {
      const db = await openDb();
      const tx = db.transaction(POSITIONS, 'readwrite');
      const store = tx.objectStore(POSITIONS);
      const current = await promisify(store.get(key)) as Row | undefined;
      if (current && !isNewer(current.observedAt, observedAt)) store.delete(key);
      await done(tx);
    },
  };
}
