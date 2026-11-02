// Download a book for offline reading, or remove the device's copy.
import { useState } from 'react';
import { CheckCircle2, CloudDownload, Loader2 } from 'lucide-react';
import type { BookDetail } from '../lib/api';
import { useT } from '../lib/i18n';
import {
  epubFormatOf, useDownloadBook, useOfflineBook, useRemoveDownload,
} from '../lib/offline/useOffline';

export function OfflineDownloadButton({ book, className }: { book: BookDetail; className?: string }) {
  const t = useT();
  const { data: copy, isLoading } = useOfflineBook(book.id);
  const download = useDownloadBook();
  const remove = useRemoveDownload();
  const [message, setMessage] = useState<string | null>(null);
  if (typeof indexedDB === 'undefined' || !epubFormatOf(book) || isLoading) return null;

  if (copy) {
    return (
      <button type="button" className={className} data-testid="offline-download"
        aria-pressed="true" disabled={remove.isPending}
        title={t('Remove from this device')}
        onClick={() => {
          if (!window.confirm(t('Remove this book from this device? You can download it again while online.'))) return;
          remove.mutate(book.id);
        }}>
        <CheckCircle2 size={15} aria-hidden="true" focusable={false} />
        {t('On this device')}
      </button>
    );
  }

  return (
    <>
      <button type="button" className={className} data-testid="offline-download"
        aria-pressed="false" disabled={download.isPending}
        onClick={() => {
          setMessage(null);
          download.mutate(book, {
            onError: () => setMessage(t('Could not download this book for offline reading.')),
          });
        }}>
        {download.isPending
          ? <Loader2 size={15} aria-hidden="true" focusable={false} />
          : <CloudDownload size={15} aria-hidden="true" focusable={false} />}
        {download.isPending ? t('Downloading…') : t('Download for offline')}
      </button>
      {message && <span role="alert">{message}</span>}
    </>
  );
}
