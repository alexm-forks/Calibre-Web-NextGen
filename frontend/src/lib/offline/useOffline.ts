// React side of offline books: download/remove, the downloaded list, and what
// the reader needs to open a book without the server.
import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { resourceUrl, type BookDetail } from '../api';
import { useMe } from '../queries';
import { getReaderContentUrl } from '../readerTarget';
import {
  OFFLINE_CHANGED_EVENT, getLocalPlace, getOfflineBook, listOfflineBooks, putOfflineBook,
  removeOfflineBook, requestPersistentStorage, storageStatus, type OfflineBook,
} from './bookStore';
import { positionOutbox } from './positionSync';

const offlineKey = ['offline'] as const;

/** The EPUB the reader would open for this book, or null when there is none. */
export function epubFormatOf(detail: BookDetail) {
  return detail.formats.find(f => f.format.toLowerCase() === 'epub') ?? null;
}

async function fetchBlob(url: string): Promise<Blob> {
  const response = await fetch(resourceUrl(url), { credentials: 'include' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.blob();
}

/** Fetch the book's EPUB (the same file the reader opens, which keeps its
 * positions aligned with the Kobo's KEPUB) and cover, and keep them. */
export async function downloadBook(userId: number, detail: BookDetail): Promise<OfflineBook> {
  const epubFormat = epubFormatOf(detail);
  if (!epubFormat) throw new Error('This book has no EPUB to download.');
  // First, while the click still counts as the user's action: Firefox asks
  // the user before it promises not to evict the site's storage.
  const persist = requestPersistentStorage();
  const epub = await fetchBlob(getReaderContentUrl(detail.id, epubFormat.format, epubFormat.content_url));
  const cover = detail.cover_url ? await fetchBlob(detail.cover_url).catch(() => null) : null;
  await persist;
  const book: OfflineBook = {
    userId, bookId: detail.id, detail, epub, cover,
    size: epub.size + (cover?.size ?? 0),
    downloadedAt: new Date().toISOString(),
  };
  await putOfflineBook(book);
  return book;
}

/** Refresh every offline query when downloads change, in this tab or another. */
function useOfflineChanges() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const refresh = () => { void queryClient.invalidateQueries({ queryKey: offlineKey }); };
    window.addEventListener(OFFLINE_CHANGED_EVENT, refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener(OFFLINE_CHANGED_EVENT, refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [queryClient]);
}

const hasIndexedDb = () => typeof indexedDB !== 'undefined';

export function useOfflineBooks() {
  useOfflineChanges();
  const { data: me } = useMe();
  const userId = me && !me.role?.anonymous ? me.id : null;
  return useQuery({
    queryKey: [...offlineKey, 'books', userId],
    queryFn: () => (userId === null ? [] : listOfflineBooks(userId)),
    enabled: hasIndexedDb(),
    staleTime: Infinity,
    retry: false,
  });
}

export function useOfflineBook(bookId: number | string) {
  useOfflineChanges();
  const { data: me } = useMe();
  const userId = me && !me.role?.anonymous ? me.id : null;
  return useQuery({
    queryKey: [...offlineKey, 'book', userId, String(bookId)],
    queryFn: () => (userId === null ? null : getOfflineBook(userId, Number(bookId))),
    enabled: hasIndexedDb(),
    staleTime: Infinity,
    retry: false,
  });
}

export function useStorageStatus() {
  useOfflineChanges();
  return useQuery({
    queryKey: [...offlineKey, 'storage'],
    queryFn: storageStatus,
    staleTime: Infinity,
    retry: false,
  });
}

export function useDownloadBook() {
  const { data: me } = useMe();
  return useMutation({
    mutationFn: (detail: BookDetail) => {
      if (!me || me.role?.anonymous) throw new Error('Sign in to download books.');
      return downloadBook(me.id, detail);
    },
  });
}

export function useRemoveDownload() {
  const { data: me } = useMe();
  return useMutation({
    mutationFn: async (bookId: number) => {
      if (!me) return;
      await removeOfflineBook(me.id, bookId);
    },
  });
}

export interface OfflineReading {
  /** False until the device lookups below have answered. */
  loaded: boolean;
  copy: OfflineBook | null;
  pending: { bookmark: string; observedAt: string } | null;
  local: { bookmark: string; observedAt: string } | null;
}

/** Everything on this device the reader can open a book from. */
export function useOfflineReading(bookId: number | string): OfflineReading {
  const { data: me, isFetched: meFetched } = useMe();
  const userId = me && !me.role?.anonymous ? me.id : null;
  const query = useQuery({
    queryKey: [...offlineKey, 'reading', userId, String(bookId)],
    queryFn: async () => {
      if (userId === null) return { copy: null, pending: null, local: null };
      const id = Number(bookId);
      const [copy, pending, local] = await Promise.all([
        getOfflineBook(userId, id).catch(() => null),
        positionOutbox().pending(id).then(rows => rows[0] ?? null).catch(() => null),
        getLocalPlace(userId, id).catch(() => null),
      ]);
      return { copy, pending, local };
    },
    enabled: meFetched,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });
  if (!hasIndexedDb()) return { loaded: true, copy: null, pending: null, local: null };
  const data = query.data;
  return {
    loaded: !!data || query.isError,
    copy: data?.copy ?? null,
    pending: data?.pending ?? null,
    local: data?.local ?? null,
  };
}
