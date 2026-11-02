/** One wire payload for debounced saves, the teardown keepalive and the
 * offline outbox (lib/offline/positionSync.ts). `observedAt` is when the
 * reader was at this place; the server orders late saves by it. */
export function readerBookmarkBody(
  bookmark: string,
  percentage: number | null | undefined,
  shareWithDevices: boolean,
  observedAt?: string | null,
): {
  format: 'epub'; bookmark: string; percentage?: number; share_with_devices: boolean;
  observed_at?: string;
} {
  return {
    format: 'epub',
    bookmark,
    ...(percentage != null ? { percentage } : {}),
    share_with_devices: shareWithDevices,
    ...(observedAt ? { observed_at: observedAt } : {}),
  };
}
