// "On this device": the books downloaded for offline reading, at the top of
// the library. Everything here comes from the device (lib/offline), so the row
// is there and every book in it opens with no connection at all.
import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { HardDriveDownload, WifiOff } from 'lucide-react';
import { useT } from '../lib/i18n';
import type { OfflineBook } from '../lib/offline/bookStore';
import { useOfflineBooks, useStorageStatus } from '../lib/offline/useOffline';
import styles from './OfflineShelf.module.css';

function useOnline(): boolean {
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine !== false);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine !== false);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function Cover({ book }: { book: OfflineBook }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!book.cover) return undefined;
    const url = URL.createObjectURL(book.cover);
    setSrc(url);
    return () => URL.revokeObjectURL(url);
  }, [book.cover]);
  return src
    ? <img className={styles.cover} src={src} alt="" loading="lazy" />
    : <span className={styles.coverBlank} aria-hidden="true">{book.detail.title.slice(0, 1)}</span>;
}

export function OfflineShelf() {
  const t = useT();
  const online = useOnline();
  const { data: books } = useOfflineBooks();
  const { data: storage } = useStorageStatus();
  if (!books || books.length === 0) return null;
  const total = books.reduce((sum, book) => sum + book.size, 0);
  return (
    <section className={styles.box} aria-labelledby="offline-shelf-title" data-testid="offline-shelf">
      <div className={styles.head}>
        <span className={styles.icon} aria-hidden="true">
          {online ? <HardDriveDownload size={18} /> : <WifiOff size={18} />}
        </span>
        <div>
          <h2 className={styles.title} id="offline-shelf-title">{t('On this device')}</h2>
          <p className={styles.sub}>
            {online
              ? t('{count} books · {size}', { count: books.length, size: megabytes(total) })
              : t('You are offline. These books can still be read.')}
          </p>
        </div>
      </div>
      {storage?.persisted === false && (
        <p className={styles.warning}>
          {t('Your browser may remove these books if the device runs low on space.')}
        </p>
      )}
      <ul className={styles.strip}>
        {books.map(book => (
          <li key={book.bookId} className={styles.item}>
            <Link href={`/read/${book.bookId}`} className={styles.card}
              aria-label={t('Read {title}', { title: book.detail.title })}>
              <Cover book={book} />
              <span className={styles.bookTitle}>{book.detail.title}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
