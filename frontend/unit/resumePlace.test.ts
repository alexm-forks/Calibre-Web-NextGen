import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickResumeBookmark } from '../src/lib/offline/resumePlace.ts';

const pending = { bookmark: 'unsent', observedAt: '2026-11-02T10:05:00.000Z' };
const local = { bookmark: 'device-last', observedAt: '2026-11-02T10:00:00.000Z' };

test('an unsent place from this device wins over everything', () => {
  assert.equal(pickResumeBookmark({ server: { bookmark: 'server' }, pending, local }), 'unsent');
  assert.equal(pickResumeBookmark({ server: undefined, pending, local }), 'unsent');
});

test('online, the server place wins over this device\'s last (already sent) place', () => {
  assert.equal(pickResumeBookmark({ server: { bookmark: 'server' }, pending: null, local }), 'server');
});

test('a server that answered "no place" is respected (e.g. marked unread)', () => {
  assert.equal(pickResumeBookmark({ server: { bookmark: null }, pending: null, local }), null);
});

test('offline, this device\'s last place is used', () => {
  assert.equal(pickResumeBookmark({ server: undefined, pending: null, local }), 'device-last');
});

test('offline with nothing on the device opens at the start', () => {
  assert.equal(pickResumeBookmark({ server: undefined, pending: null, local: null }), null);
});
