import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createMemoryStore, createPositionOutbox, outboxKey, type PendingPosition, type SendResult,
} from '../src/lib/offline/positionOutbox.ts';
import { readerBookmarkBody } from '../src/lib/readerBookmark.ts';

const at = (minute: number) => new Date(Date.UTC(2026, 10, 2, 10, minute)).toISOString();

function position(bookId: number, minute: number, bookmark = `cfi-${bookId}-${minute}`): PendingPosition {
  return {
    bookId, format: 'epub', bookmark, percentage: minute, shareWithDevices: true, observedAt: at(minute),
  };
}

function harness(results: SendResult[] = []) {
  const sent: PendingPosition[] = [];
  const store = createMemoryStore();
  const outbox = createPositionOutbox(store, async p => {
    sent.push(p);
    return results.length ? results.shift()! : 'sent';
  });
  return { outbox, store, sent };
}

test('only the newest position per book is kept', async () => {
  const { outbox } = harness();
  await outbox.record(position(1, 5));
  await outbox.record(position(1, 9));
  await outbox.record(position(1, 7)); // an older save arriving late from another tab
  const pending = await outbox.pending(1);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].observedAt, at(9));
});

test('each book keeps its own position', async () => {
  const { outbox } = harness();
  await outbox.record(position(1, 5));
  await outbox.record(position(2, 6));
  assert.equal((await outbox.pending()).length, 2);
});

test('a flush sends oldest first and empties the outbox', async () => {
  const { outbox, sent } = harness();
  await outbox.record(position(2, 8));
  await outbox.record(position(1, 3));
  const result = await outbox.flush();
  assert.deepEqual(sent.map(p => p.bookId), [1, 2]);
  assert.deepEqual(result, { sent: 2, dropped: 0, remaining: 0, needsSignIn: false });
  assert.equal((await outbox.pending()).length, 0);
});

test('offline keeps everything for later, in order', async () => {
  const { outbox, sent } = harness(['retry']);
  await outbox.record(position(1, 3));
  await outbox.record(position(2, 4));
  const result = await outbox.flush();
  assert.equal(sent.length, 1, 'stops at the first transport failure');
  assert.equal(result.remaining, 2);
  assert.equal((await outbox.pending()).length, 2);
});

test('a thrown transport error is treated as offline, not as sent', async () => {
  const store = createMemoryStore();
  const outbox = createPositionOutbox(store, async () => { throw new TypeError('Failed to fetch'); });
  await outbox.record(position(1, 3));
  const result = await outbox.flush();
  assert.equal(result.remaining, 1);
  assert.equal((await outbox.pending(1)).length, 1);
});

test('signed out keeps the position and reports that sign-in is needed', async () => {
  const { outbox } = harness(['auth']);
  await outbox.record(position(1, 3));
  const result = await outbox.flush();
  assert.equal(result.needsSignIn, true);
  assert.equal((await outbox.pending(1)).length, 1, 'a 401 must never cost unsent reading');
});

test('a permanent refusal is dropped so it cannot block other books', async () => {
  const { outbox, sent } = harness(['drop', 'sent']);
  await outbox.record(position(1, 3));
  await outbox.record(position(2, 4));
  const result = await outbox.flush();
  assert.equal(sent.length, 2);
  assert.deepEqual([result.sent, result.dropped, result.remaining], [1, 1, 0]);
});

test('a newer position recorded while the older one is in flight survives the flush', async () => {
  const store = createMemoryStore();
  let outbox: ReturnType<typeof createPositionOutbox>;
  outbox = createPositionOutbox(store, async p => {
    if (p.observedAt === at(3)) await outbox.record(position(1, 4)); // page turned mid-send
    return 'sent';
  });
  await outbox.record(position(1, 3));
  await outbox.flush();
  const pending = await outbox.pending(1);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].observedAt, at(4));
});

test('settle forgets the sent save and anything older, never anything newer', async () => {
  const { outbox } = harness();
  await outbox.record(position(1, 6));
  await outbox.settle(1, 'epub', at(5));
  assert.equal((await outbox.pending(1)).length, 1, 'a newer pending save is kept');
  await outbox.settle(1, 'EPUB', at(6));
  assert.equal((await outbox.pending(1)).length, 0);
});

test('flushes are single-flight', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  const outbox = createPositionOutbox(createMemoryStore(), async () => {
    calls += 1;
    await gate;
    return 'sent';
  });
  await outbox.record(position(1, 3));
  const first = outbox.flush();
  const second = outbox.flush();
  assert.equal(first, second);
  release();
  await first;
  assert.equal(calls, 1);
});

test('the key is case-insensitive in the format', () => {
  assert.equal(outboxKey(7, 'EPUB'), outboxKey(7, 'epub'));
});

test('queued saves carry their reading time on the wire', () => {
  const body = readerBookmarkBody('cfi', 42, true, at(3));
  assert.equal(body.observed_at, at(3));
  assert.equal(Object.prototype.hasOwnProperty.call(readerBookmarkBody('cfi', 42, true), 'observed_at'), false);
});
