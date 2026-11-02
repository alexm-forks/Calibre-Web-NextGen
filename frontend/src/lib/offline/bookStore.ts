// Books downloaded for offline reading, and the last place reached in each
// book on this device. IndexedDB (cwng-offline, stores `books` and `places`).
//
// Everything is keyed by user as well as book: several people can share one
// browser, and one person's downloads and places must never show for another.
import type { BookDetail } from '../api';
import { BOOKS, PLACES, done, openOfflineDb, promisify } from './idbStore';
import { isNewer } from './positionOutbox';
import type { LocalPlace } from './resumePlace';

export interface OfflineBook {
  userId: number;
  bookId: number;
  /** The book's detail as the server returned it at download time. The
   * reader uses it when the server can't be reached. */
  detail: BookDetail;
  epub: Blob;
  cover: Blob | null;
  /** Bytes stored for this book (EPUB + cover). */
  size: number;
  downloadedAt: string;
}

interface BookRow extends OfflineBook { key: string }
interface PlaceRow extends LocalPlace { key: string; userId: number; bookId: number }

export const OFFLINE_CHANGED_EVENT = 'cwng:offline-books-changed';

const keyOf = (userId: number, bookId: number) => `${userId}:${bookId}`;

function changed(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(OFFLINE_CHANGED_EVENT));
}

function strip<T extends { key: string }>(row: T): Omit<T, 'key'> {
  const { key: _key, ...rest } = row;
  return rest;
}

export async function putOfflineBook(book: OfflineBook): Promise<void> {
  const db = await openOfflineDb();
  const tx = db.transaction(BOOKS, 'readwrite');
  tx.objectStore(BOOKS).put({ ...book, key: keyOf(book.userId, book.bookId) } satisfies BookRow);
  await done(tx);
  changed();
}

export async function getOfflineBook(userId: number, bookId: number): Promise<OfflineBook | null> {
  const db = await openOfflineDb();
  const row = await promisify(db.transaction(BOOKS).objectStore(BOOKS).get(keyOf(userId, bookId)));
  return row ? strip(row as BookRow) : null;
}

/** Every book this user downloaded on this device, most recent first. */
export async function listOfflineBooks(userId: number): Promise<OfflineBook[]> {
  const db = await openOfflineDb();
  const rows = await promisify(db.transaction(BOOKS).objectStore(BOOKS).getAll()) as BookRow[];
  return rows.filter(row => row.userId === userId).map(strip)
    .sort((a, b) => Date.parse(b.downloadedAt) - Date.parse(a.downloadedAt));
}

export async function removeOfflineBook(userId: number, bookId: number): Promise<void> {
  const db = await openOfflineDb();
  const tx = db.transaction(BOOKS, 'readwrite');
  tx.objectStore(BOOKS).delete(keyOf(userId, bookId));
  await done(tx);
  changed();
}

/** Remember the newest place reached in a book on this device. */
export async function recordLocalPlace(userId: number, bookId: number, place: LocalPlace): Promise<void> {
  const db = await openOfflineDb();
  const tx = db.transaction(PLACES, 'readwrite');
  const store = tx.objectStore(PLACES);
  const key = keyOf(userId, bookId);
  const current = await promisify(store.get(key)) as PlaceRow | undefined;
  if (!current || !isNewer(current.observedAt, place.observedAt)) {
    store.put({ ...place, key, userId, bookId } satisfies PlaceRow);
  }
  await done(tx);
}

export async function getLocalPlace(userId: number, bookId: number): Promise<LocalPlace | null> {
  const db = await openOfflineDb();
  const row = await promisify(db.transaction(PLACES).objectStore(PLACES).get(keyOf(userId, bookId)));
  if (!row) return null;
  const { bookmark, observedAt } = row as PlaceRow;
  return { bookmark, observedAt };
}

export interface StorageStatus {
  /** True when the browser promised not to evict this site's data. */
  persisted: boolean | null;
  usage: number | null;
  quota: number | null;
}

export async function storageStatus(): Promise<StorageStatus> {
  const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined;
  const persisted = storage?.persisted ? await storage.persisted().catch(() => null) : null;
  const estimate = storage?.estimate ? await storage.estimate().catch(() => null) : null;
  return { persisted, usage: estimate?.usage ?? null, quota: estimate?.quota ?? null };
}

/** Ask the browser not to evict downloaded books. Firefox shows a prompt, so
 * call this from the user's own action (the download button). */
export async function requestPersistentStorage(): Promise<boolean | null> {
  const storage = typeof navigator !== 'undefined' ? navigator.storage : undefined;
  if (!storage?.persist) return null;
  try {
    if (await storage.persisted()) return true;
    return await storage.persist();
  } catch {
    return null;
  }
}
