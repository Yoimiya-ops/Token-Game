/**
 * Session-receiver: store + validate unit tests.
 *
 * Run with: `corepack pnpm --filter @token-game/server test`
 *
 * Coverage mirrors the verification cases in
 * `docs/design/session-based-token-collection.md` § 验收标准.
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  applyTick,
  closeSession,
  evaluateManualRefresh,
  getDevice,
  getOpenSession,
  MIN_MANUAL_REFRESH_INTERVAL_MS,
  openSession,
  readSessionStore,
  registerDevice,
  resetSessionStoreForTest,
  sweepIdleSessions,
  verifyCursorMonotonicity,
  writeSessionStore,
  type SessionStoreFile
} from './index';
import {
  generateDeviceKey,
  parseTickRequest,
  signTick,
  verifyTickSignature
} from './validate';
import type {
  FileCursor,
  FileSnapshot,
  TickRequest
} from './types';

function tempStorePath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'token-game-session-store-'));
  return join(dir, 'sessions.json');
}

function snapshot(p: string, providerId: string, size: number, inode = 1): FileSnapshot {
  return { providerId, path: p, size, inode };
}

function cursor(p: string, providerId: string, size: number, inode = 1): FileCursor {
  return { providerId, path: p, size, inode };
}

// ─────────────────────────────────────────────────────────────────
// Store: register & open
// ─────────────────────────────────────────────────────────────────

test('registerDevice mints a new record and is idempotent on key collision', () => {
  const store: SessionStoreFile = { version: 1, updatedAt: '', devices: {} };
  const k = generateDeviceKey();
  registerDevice(store, { deviceKey: k, firstSeenAt: '2026-07-07T00:00:00.000Z' });
  assert.equal(store.devices[k].deviceKey, k);
  assert.equal(store.devices[k].firstSeenAt, '2026-07-07T00:00:00.000Z');
  // second register is no-op
  registerDevice(store, { deviceKey: k, firstSeenAt: '2026-07-08T00:00:00.000Z' });
  assert.equal(store.devices[k].firstSeenAt, '2026-07-07T00:00:00.000Z');
});

test('openSession creates a record with the baseline cursors', () => {
  const store: SessionStoreFile = { version: 1, updatedAt: '', devices: {} };
  const k = generateDeviceKey();
  registerDevice(store, { deviceKey: k, firstSeenAt: '2026-07-07T00:00:00.000Z' });
  const baseline = [snapshot('/claude.jsonl', 'claude-code', 1024)];
  const opened = openSession(store, {
    deviceKey: k,
    sessionId: 'sess-1',
    baselineCursors: baseline,
    clientLabel: 'test',
    openedAt: '2026-07-07T00:00:00.000Z'
  });
  assert.equal(opened.ok, true);
  if (opened.ok) {
    assert.equal(opened.session.sessionId, 'sess-1');
    assert.deepEqual(opened.session.baselineCursors, baseline);
    assert.equal(opened.session.appliedCursors.length, 1);
    assert.equal(opened.session.totalDeltas, 0);
    assert.equal(opened.session.totalQiGained, 0);
  }
});

test('openSession refuses a second open request for the same device', () => {
  const store: SessionStoreFile = { version: 1, updatedAt: '', devices: {} };
  const k = generateDeviceKey();
  registerDevice(store, { deviceKey: k, firstSeenAt: '2026-07-07T00:00:00.000Z' });
  const first = openSession(store, {
    deviceKey: k,
    sessionId: 'sess-1',
    baselineCursors: [],
    clientLabel: null,
    openedAt: '2026-07-07T00:00:00.000Z'
  });
  assert.equal(first.ok, true);
  const second = openSession(store, {
    deviceKey: k,
    sessionId: 'sess-2',
    baselineCursors: [],
    clientLabel: null,
    openedAt: '2026-07-07T00:00:01.000Z'
  });
  assert.equal(second.ok, false);
  if (!second.ok) {
    assert.equal(second.reason, 'session_already_open');
  }
});

// ─────────────────────────────────────────────────────────────────
// Cursor monotonicity
// ─────────────────────────────────────────────────────────────────

test('verifyCursorMonotonicity: empty applied + empty cursorAfter is OK (no watched files yet)', () => {
  const session = makeSession();
  assert.equal(verifyCursorMonotonicity(session, []), null);
});

test('verifyCursorMonotonicity: cursor advancing is OK', () => {
  const session = makeSession();
  session.appliedCursors = [cursor('/a.jsonl', 'claude-code', 1024, 5)];
  const next = [cursor('/a.jsonl', 'claude-code', 2048, 5)];
  assert.equal(verifyCursorMonotonicity(session, next), null);
});

test('verifyCursorMonotonicity: cursor regression is rejected', () => {
  const session = makeSession();
  session.appliedCursors = [cursor('/a.jsonl', 'claude-code', 2048, 5)];
  const next = [cursor('/a.jsonl', 'claude-code', 1024, 5)];
  assert.equal(verifyCursorMonotonicity(session, next), 'cursor_regressed');
});

test('verifyCursorMonotonicity: rotation (inode change) is rejected', () => {
  const session = makeSession();
  session.appliedCursors = [cursor('/a.jsonl', 'claude-code', 2048, 5)];
  const next = [cursor('/a.jsonl', 'claude-code', 1024, 6)];
  assert.equal(verifyCursorMonotonicity(session, next), 'inode_changed');
});

test('verifyCursorMonotonicity: cursor missing a previously-watched path is rejected', () => {
  const session = makeSession();
  session.appliedCursors = [cursor('/a.jsonl', 'claude-code', 1024, 5)];
  const next: FileCursor[] = []; // /a.jsonl disappeared
  assert.equal(verifyCursorMonotonicity(session, next), 'cursor_missing');
});

// ─────────────────────────────────────────────────────────────────
// applyTick
// ─────────────────────────────────────────────────────────────────

test('applyTick advances appliedCursors and accumulates qi', () => {
  const store: SessionStoreFile = { version: 1, updatedAt: '', devices: {} };
  const k = generateDeviceKey();
  registerDevice(store, { deviceKey: k, firstSeenAt: 't0' });
  openSession(store, {
    deviceKey: k,
    sessionId: 'sess-1',
    baselineCursors: [snapshot('/a.jsonl', 'claude-code', 1024, 5)],
    clientLabel: null,
    openedAt: 't0'
  });
  const outcome = applyTick(store, {
    deviceKey: k,
    sessionId: 'sess-1',
    cursorAfter: [cursor('/a.jsonl', 'claude-code', 4096, 5)],
    deltas: [makeDelta('claude-code', 'gpt-4', 100)],
    qiGained: 11,
    tokensGained: 100,
    triggersBySource: { 'claude-code': 100 },
    audit: null,
    appliedAt: 't1'
  });
  assert.equal(outcome.ok, true);
  if (outcome.ok) {
    assert.equal(outcome.session.totalDeltas, 1);
    assert.equal(outcome.session.totalQiGained, 11);
    assert.equal(outcome.session.appliedCursors[0].size, 4096);
    assert.equal(outcome.device.totalQiGained, 11);
  }
});

test('applyTick rejects a sessionId that is not open', () => {
  const store: SessionStoreFile = { version: 1, updatedAt: '', devices: {} };
  const k = generateDeviceKey();
  registerDevice(store, { deviceKey: k, firstSeenAt: 't0' });
  const outcome = applyTick(store, {
    deviceKey: k,
    sessionId: 'never-opened',
    cursorAfter: [],
    deltas: [],
    qiGained: 0,
    tokensGained: 0,
    triggersBySource: {},
    audit: null,
    appliedAt: 't1'
  });
  assert.equal(outcome.ok, false);
  if (!outcome.ok) {
    assert.equal(outcome.reason, 'session_closed');
  }
});

test('applyTick records manual-refresh audit trail and bumps lastManualRefreshAt', () => {
  const store: SessionStoreFile = { version: 1, updatedAt: '', devices: {} };
  const k = generateDeviceKey();
  registerDevice(store, { deviceKey: k, firstSeenAt: 't0' });
  openSession(store, {
    deviceKey: k,
    sessionId: 'sess-1',
    baselineCursors: [snapshot('/a.jsonl', 'claude-code', 1024, 5)],
    clientLabel: null,
    openedAt: 't0'
  });
  applyTick(store, {
    deviceKey: k,
    sessionId: 'sess-1',
    cursorAfter: [cursor('/a.jsonl', 'claude-code', 2048, 5)],
    deltas: [makeDelta('claude-code', 'gpt-4', 100)],
    qiGained: 11,
    tokensGained: 100,
    triggersBySource: { 'claude-code': 100 },
    audit: { at: 't1', deltasEmitted: 1, tickDurationMs: 4 },
    appliedAt: 't1'
  });
  const session = getOpenSession(store, k);
  assert.ok(session);
  assert.equal(session?.manualRefreshes.length, 1);
  assert.equal(session?.lastManualRefreshAt, 't1');
});

// ─────────────────────────────────────────────────────────────────
// Manual-refresh rate limit
// ─────────────────────────────────────────────────────────────────

test('evaluateManualRefresh: first manual refresh is allowed', () => {
  const result = evaluateManualRefresh(new Date('2026-07-07T00:00:00.000Z'), null, 5_000);
  assert.equal(result.allowed, true);
});

test('evaluateManualRefresh: 4.9s after the last is rate-limited with retryAfterMs', () => {
  const result = evaluateManualRefresh(
    new Date('2026-07-07T00:00:04.900Z'),
    '2026-07-07T00:00:00.000Z',
    5_000
  );
  assert.equal(result.allowed, false);
  if (!result.allowed) {
    assert.ok(result.retryAfterMs >= 100);
    assert.ok(result.retryAfterMs <= 200);
  }
});

test('evaluateManualRefresh: exactly at 5s it becomes allowed again', () => {
  const result = evaluateManualRefresh(
    new Date('2026-07-07T00:00:05.000Z'),
    '2026-07-07T00:00:00.000Z',
    5_000
  );
  assert.equal(result.allowed, true);
});

test('MIN_MANUAL_REFRESH_INTERVAL_MS is 5000 (player-facing constant)', () => {
  assert.equal(MIN_MANUAL_REFRESH_INTERVAL_MS, 5_000);
});

// ─────────────────────────────────────────────────────────────────
// Close & sweep
// ─────────────────────────────────────────────────────────────────

test('closeSession moves the open session into closedSessions', () => {
  const store: SessionStoreFile = { version: 1, updatedAt: '', devices: {} };
  const k = generateDeviceKey();
  registerDevice(store, { deviceKey: k, firstSeenAt: 't0' });
  openSession(store, {
    deviceKey: k,
    sessionId: 'sess-1',
    baselineCursors: [],
    clientLabel: null,
    openedAt: 't0'
  });
  const closed = closeSession(store, {
    deviceKey: k,
    sessionId: 'sess-1',
    closedAt: 't1'
  });
  assert.equal(closed.ok, true);
  if (closed.ok) {
    assert.equal(closed.session.endedAt, 't1');
  }
  assert.equal(getOpenSession(store, k), null);
  assert.equal(store.devices[k].closedSessions.length, 1);
});

test('closeSession rejects when no session is open (closed twice)', () => {
  const store: SessionStoreFile = { version: 1, updatedAt: '', devices: {} };
  const k = generateDeviceKey();
  registerDevice(store, { deviceKey: k, firstSeenAt: 't0' });
  const result = closeSession(store, {
    deviceKey: k,
    sessionId: 'sess-1',
    closedAt: 't1'
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, 'session_closed');
  }
});

test('sweepIdleSessions closes sessions idle past the threshold', () => {
  const store: SessionStoreFile = { version: 1, updatedAt: '', devices: {} };
  const k = generateDeviceKey();
  registerDevice(store, { deviceKey: k, firstSeenAt: 't0' });
  openSession(store, {
    deviceKey: k,
    sessionId: 'sess-1',
    baselineCursors: [],
    clientLabel: null,
    openedAt: '2026-07-07T00:00:00.000Z'
  });
  // 35 minutes later — sweep should fire
  const swept = sweepIdleSessions(store, {
    now: new Date('2026-07-07T00:35:00.000Z'),
    maxIdleMs: 30 * 60_000
  });
  assert.equal(swept, 1);
  assert.equal(getOpenSession(store, k), null);
  assert.equal(store.devices[k].closedSessions.length, 1);
});

// ─────────────────────────────────────────────────────────────────
// File persistence
// ─────────────────────────────────────────────────────────────────

test('readSessionStore / writeSessionStore roundtrips a device', () => {
  const path = tempStorePath();
  const store = readSessionStore(path);
  const k = generateDeviceKey();
  registerDevice(store, { deviceKey: k, firstSeenAt: 't0' });
  writeSessionStore(store, path);
  const reloaded = readSessionStore(path);
  assert.ok(getDevice(reloaded, k));
  resetSessionStoreForTest(path);
});

test('readSessionStore returns empty store when file is missing', () => {
  const path = tempStorePath();
  const store = readSessionStore(path);
  assert.deepEqual(Object.keys(store.devices), []);
});

test('readSessionStore recovers from a corrupt store file', () => {
  const path = tempStorePath();
  // Write garbage
  writeFileSync(path, '{not valid json');
  const store = readSessionStore(path);
  assert.deepEqual(Object.keys(store.devices), []);
});

// ─────────────────────────────────────────────────────────────────
// HMAC sign / verify
// ─────────────────────────────────────────────────────────────────

test('signTick + verifyTickSignature roundtrip with the same deviceKey', () => {
  const k = generateDeviceKey();
  const tick = makeSignedTick(k, 'sess-1', 'scheduled', []);
  assert.equal(verifyTickSignature(tick), true);
});

test('verifyTickSignature rejects when the body is tampered but signature kept', () => {
  const k = generateDeviceKey();
  const tick = makeSignedTick(k, 'sess-1', 'scheduled', []);
  const tampered = { ...tick, trigger: 'manual' as const };
  assert.equal(verifyTickSignature(tampered), false);
});

test('verifyTickSignature rejects when the deviceKey does not match', () => {
  const k = generateDeviceKey();
  const tick = makeSignedTick(k, 'sess-1', 'scheduled', []);
  const stolen = { ...tick, deviceKey: generateDeviceKey() };
  assert.equal(verifyTickSignature(stolen), false);
});

test('verifyTickSignature rejects a malformed signature', () => {
  const k = generateDeviceKey();
  const tick = makeSignedTick(k, 'sess-1', 'scheduled', []);
  const broken = { ...tick, signature: 'not-hex' };
  assert.equal(verifyTickSignature(broken), false);
});

test('verifyTickSignature rejects a deviceKey that is too short', () => {
  const tick = makeSignedTick('short', 'sess-1', 'scheduled', []);
  const broken = { ...tick, signature: signTick(tick, 'short') };
  assert.equal(verifyTickSignature(broken), false);
});

// ─────────────────────────────────────────────────────────────────
// parseTickRequest
// ─────────────────────────────────────────────────────────────────

test('parseTickRequest rejects non-object input', () => {
  assert.equal(parseTickRequest(null), null);
  assert.equal(parseTickRequest('garbage'), null);
  assert.equal(parseTickRequest(undefined), null);
});

test('parseTickRequest rejects missing fields', () => {
  assert.equal(parseTickRequest({ deviceKey: 'k' }), null);
  assert.equal(parseTickRequest({ deviceKey: 'k', sessionId: 's' }), null);
});

test('parseTickRequest accepts a minimal valid envelope', () => {
  const k = generateDeviceKey();
  const body = {
    deviceKey: k,
    sessionId: 'sess-1',
    trigger: 'scheduled' as const,
    clientTimestamp: '2026-07-07T00:00:00.000Z',
    deltas: [],
    cursorAfter: [],
    signature: 'unused'
  };
  const parsed = parseTickRequest(body);
  assert.ok(parsed);
});

test('parseTickRequest rejects a negative token count in a delta', () => {
  const k = generateDeviceKey();
  const body = {
    deviceKey: k,
    sessionId: 'sess-1',
    trigger: 'scheduled' as const,
    clientTimestamp: '2026-07-07T00:00:00.000Z',
    deltas: [
      {
        key: 'k',
        source: 'claude-code',
        model: 'gpt-4',
        hourStart: 't',
        inputTokens: -1,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0
      }
    ],
    cursorAfter: [],
    signature: 'unused'
  };
  assert.equal(parseTickRequest(body), null);
});

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function makeSession() {
  return {
    sessionId: 'sess-x',
    startedAt: 't0',
    endedAt: null,
    clientLabel: null,
    baselineCursors: [] as FileSnapshot[],
    appliedCursors: [] as FileCursor[],
    totalDeltas: 0,
    totalQiGained: 0,
    manualRefreshes: [],
    lastManualRefreshAt: null
  };
}

function makeDelta(
  source: string,
  model: string,
  tokenCount: number,
  hourStart = '2026-07-07T00:00:00.000Z'
): import('./types').SessionBucketDelta {
  return {
    key: `${source}|${model}|${hourStart}|input`,
    source,
    model,
    hourStart,
    inputTokens: tokenCount,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0
  };
}

function makeSignedTick(
  deviceKey: string,
  sessionId: string,
  trigger: 'scheduled' | 'manual',
  cursorAfter: FileCursor[]
): TickRequest {
  const partial: Omit<TickRequest, 'signature'> = {
    deviceKey,
    sessionId,
    trigger,
    clientTimestamp: '2026-07-07T00:00:00.000Z',
    deltas: [],
    cursorAfter
  };
  return { ...partial, signature: signTick(partial, deviceKey) };
}
