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
const DB_VERSION = 1;
const POSITIONS = 'positions';

interface Row extends PendingPosition { key: string }

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
    tx.onerror = () => reject(tx.error);
  });
}

export function openOfflineDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(POSITIONS)) {
        db.createObjectStore(POSITIONS, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('cwng-offline database upgrade blocked'));
  });
}

function strip(row: Row): PendingPosition {
  const { key: _key, ...position } = row;
  return position;
}

export function createIdbStore(dbPromise: Promise<IDBDatabase>): OutboxStore {
  return {
    async all() {
      const db = await dbPromise;
      const rows = await promisify(db.transaction(POSITIONS).objectStore(POSITIONS).getAll());
      return (rows as Row[]).map(strip);
    },
    async get(key) {
      const db = await dbPromise;
      const row = await promisify(db.transaction(POSITIONS).objectStore(POSITIONS).get(key));
      return row ? strip(row as Row) : undefined;
    },
    async putIfNewer(position) {
      const db = await dbPromise;
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
      const db = await dbPromise;
      const tx = db.transaction(POSITIONS, 'readwrite');
      const store = tx.objectStore(POSITIONS);
      const current = await promisify(store.get(key)) as Row | undefined;
      if (current && !isNewer(current.observedAt, observedAt)) store.delete(key);
      await done(tx);
    },
  };
}
