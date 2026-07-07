/**
 * Session driver: unit tests with mocked providers.
 *
 * The driver is the part of the system that actually polls CLI log
 * files and writes bucket deltas into the session-receiver store.
 * Tests here use an in-memory FakeProvider so we can drive the
 * lifecycle without touching disk.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readLedger, writeLedger, ensureLedger } from '../store';
import { generateDeviceKey } from '../session-receiver/validate';
import { SessionDriver } from './session-driver';
import type { Provider } from './providers/base';
import type { FileCursor, RawEvent } from './types';

class FakeProvider implements Provider {
  readonly id: 'claude' | 'codex';
  readonly displayName: string;
  /** JSONL content the fake parseFile reads. Updated by the test mid-flight. */
  private content: string;
  readonly path: string;
  parseDelayMs = 0;
  parseCalls = 0;

  constructor(id: 'claude' | 'codex', path: string, initialContent = '') {
    this.id = id;
    this.displayName = id;
    this.path = path;
    this.content = initialContent;
  }

  async listFiles(): Promise<string[]> {
    return [this.path];
  }

  /**
   * Pure-JSONL parser. Each line: `{"tokens": N, "kind": "input"|"cached"|"output", "model": "...", "ts": "..."}`.
   * The fake is intentionally dumb — it tracks byte offset and reports it
   * in the newCursor, mirroring the real providers' behaviour.
   */
  async parseFile(
    filePath: string,
    prevCursor: FileCursor | null
  ): Promise<{ events: RawEvent[]; newCursor: FileCursor | null }> {
    this.parseCalls += 1;
    if (this.parseDelayMs > 0) {
      await sleep(this.parseDelayMs);
    }
    const startOffset = prevCursor?.offset ?? 0;
    const slice = this.content.slice(startOffset);
    const lines = slice.split(/\r?\n/);
    const events: RawEvent[] = [];
    let consumedBytes = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const isLast = i === lines.length - 1;
      if (isLast && line.length > 0) {
        const sliceEndsWithNewline = slice.endsWith('\n');
        if (!sliceEndsWithNewline) break;
      }
      // Count the bytes for the line content + the separator. The
      // very last entry is the empty string that results from a
      // trailing \n; we count the separator with the *previous* line
      // to avoid double-counting.
      if (line.length > 0) {
        consumedBytes += Buffer.byteLength(line, 'utf8') + 1;
      }
      if (!line.trim()) continue;
      let parsed: { tokens: number; kind: 'input' | 'cached' | 'output' | 'reasoning'; model: string; ts: string };
      try {
        parsed = JSON.parse(line) as typeof parsed;
      } catch {
        continue;
      }
      events.push({
        source: this.id,
        model: parsed.model,
        kind: parsed.kind,
        tokenCount: parsed.tokens,
        occurredAt: parsed.ts
      });
    }
    return {
      events,
      newCursor: { inode: 1, offset: startOffset + consumedBytes }
    };
  }

  /** Helper used by tests to append a new line and grow the file. */
  appendLine(record: { tokens: number; kind: 'input' | 'cached' | 'output' | 'reasoning'; model: string; ts: string }) {
    this.content += JSON.stringify(record) + '\n';
    writeFileSync(this.path, this.content);
  }
}

function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), 'tg-session-driver-'));
  process.env.TOKEN_GAME_DATA_DIR = dataDir;
  const sessionStorePath = join(dataDir, 'sessions.json');
  const tmpFile = join(dataDir, 'fake.jsonl');
  writeFileSync(tmpFile, '');
  // Reset ledger so the test starts with 0 qi / totalTokens.
  ensureLedger();
  writeLedger({
    version: 1,
    player: {
      kittenName: 'test',
      realm: '',
      realmLevel: 0,
      qi: 0,
      cultivation: 0,
      food: 0,
      foodGained: 0,
      spiritStone: 0,
      spiritHerb: 0,
      pills: 0,
      totalTokens: 0,
      lastFedAt: null,
      kindling: 0
    } as any,
    events: [],
    trackerState: { bucketTokens: {}, lastSyncedAt: null, kindlingBackfilledAt: null },
    homestead: {
      omen: null,
      treasureBasin: { dayKey: null, dailyCondenses: 0, lastCondensedAt: null },
      spiritBeast: { name: '', status: 'idle', route: null, lastDispatchedAt: null, returnsAt: null },
      inventory: [],
      logs: []
    }
  } as any);
  return { dataDir, sessionStorePath, tmpFile };
}

function teardown(dataDir: string) {
  rmSync(dataDir, { recursive: true, force: true });
}

async function waitForLive(driver: SessionDriver, sessionId: string, predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await sleep(10);
  }
  throw new Error(`waitForLive timed out for ${sessionId}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ──────────────────────────────────────────────────────────────────
// Lifecycle
// ──────────────────────────────────────────────────────────────────

test('startSession captures a baseline and exposes the deviceKey + sessionId', async () => {
  const { dataDir, sessionStorePath, tmpFile } = setup();
  try {
    const fake = new FakeProvider('claude', tmpFile, '');
    const driver = new SessionDriver(sessionStorePath, {
      providers: [fake],
      tickIntervalMs: 60_000
    });
    const deviceKey = generateDeviceKey();
    const r = await driver.startSession({ deviceKey });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.response.deviceKey, deviceKey);
      assert.ok(r.response.sessionId.length > 0);
      assert.equal(r.response.manualRefreshMinIntervalMs, 5_000);
      assert.ok(driver._isLive(r.response.sessionId));
    }
    driver.shutdown();
  } finally {
    teardown(dataDir);
  }
});

test('startSession refuses a second open for the same device', async () => {
  const { dataDir, sessionStorePath, tmpFile } = setup();
  try {
    const fake = new FakeProvider('claude', tmpFile, '');
    const driver = new SessionDriver(sessionStorePath, { providers: [fake] });
    const deviceKey = generateDeviceKey();
    const a = await driver.startSession({ deviceKey });
    assert.equal(a.ok, true);
    const b = await driver.startSession({ deviceKey });
    assert.equal(b.ok, false);
    if (!b.ok) {
      assert.equal(b.reason, 'session_already_open');
    }
    driver.shutdown();
  } finally {
    teardown(dataDir);
  }
});

// ──────────────────────────────────────────────────────────────────
// Manual refresh path (no automatic ticker — interval=∞)
// ──────────────────────────────────────────────────────────────────

test('manualRefresh runs a tick, applies deltas, and bumps lastManualRefreshAt', async () => {
  const { dataDir, sessionStorePath, tmpFile } = setup();
  try {
    const fake = new FakeProvider('claude', tmpFile, '');
    // tickIntervalMs stays at the default (60s) — we never wait for it.
    const driver = new SessionDriver(sessionStorePath, { providers: [fake] });
    const deviceKey = generateDeviceKey();

    // Add some events to the fake file BEFORE the session opens so
    // they get captured in the baseline (won't be re-read unless we
    // grow the file after opening).
    fake.appendLine({ tokens: 100, kind: 'input', model: 'gpt-4', ts: '2026-07-07T00:00:00.000Z' });

    const r = await driver.startSession({ deviceKey });
    if (!r.ok) throw new Error('open failed');

    // Now grow the file (this is what a real tick would pick up).
    fake.appendLine({ tokens: 50, kind: 'output', model: 'gpt-4', ts: '2026-07-07T00:00:00.000Z' });

    const refresh = await driver.manualRefresh({
      deviceKey,
      sessionId: r.response.sessionId
    });
    assert.equal(refresh.ok, true);
    if (refresh.ok) {
      assert.ok(refresh.eventsEmitted > 0);
    }
    const ledger = readLedger();
    assert.ok(ledger.player.qi > 0, `qi=${ledger.player.qi}`);
    driver.shutdown();
  } finally {
    teardown(dataDir);
  }
});

test('manualRefresh within the 5s window is rate-limited', async () => {
  const { dataDir, sessionStorePath, tmpFile } = setup();
  try {
    const fake = new FakeProvider('claude', tmpFile, '');
    const driver = new SessionDriver(sessionStorePath, { providers: [fake] });
    const deviceKey = generateDeviceKey();
    fake.appendLine({ tokens: 10, kind: 'input', model: 'gpt-4', ts: '2026-07-07T00:00:00.000Z' });
    const r = await driver.startSession({ deviceKey });
    if (!r.ok) throw new Error('open failed');

    fake.appendLine({ tokens: 10, kind: 'output', model: 'gpt-4', ts: '2026-07-07T00:00:00.000Z' });
    const first = await driver.manualRefresh({ deviceKey, sessionId: r.response.sessionId });
    assert.equal(first.ok, true);

    fake.appendLine({ tokens: 10, kind: 'cached', model: 'gpt-4', ts: '2026-07-07T00:00:00.000Z' });
    const second = await driver.manualRefresh({ deviceKey, sessionId: r.response.sessionId });
    assert.equal(second.ok, false);
    if (!second.ok) {
      assert.equal(second.reason, 'rate_limited');
      assert.ok((second.retryAfterMs ?? 0) > 0);
    }
    driver.shutdown();
  } finally {
    teardown(dataDir);
  }
});

test('concurrent manualRefresh calls are serialized and do not double-apply tokens', async () => {
  const { dataDir, sessionStorePath, tmpFile } = setup();
  try {
    const fake = new FakeProvider('claude', tmpFile, '');
    fake.parseDelayMs = 40;
    const driver = new SessionDriver(sessionStorePath, { providers: [fake] });
    const deviceKey = generateDeviceKey();
    const r = await driver.startSession({ deviceKey });
    if (!r.ok) throw new Error('open failed');

    fake.appendLine({ tokens: 100, kind: 'input', model: 'gpt-4', ts: '2026-07-07T00:00:00.000Z' });
    const [a, b] = await Promise.all([
      driver.manualRefresh({ deviceKey, sessionId: r.response.sessionId }),
      driver.manualRefresh({ deviceKey, sessionId: r.response.sessionId })
    ]);

    const outcomes = [a, b];
    assert.equal(outcomes.filter((o) => o.ok).length, 1);
    assert.equal(outcomes.filter((o) => !o.ok && o.reason === 'rate_limited').length, 1);
    assert.equal(readLedger().player.totalTokens, 100);
    driver.shutdown();
  } finally {
    teardown(dataDir);
  }
});

test('manualRefresh on an unknown session id returns no_session', async () => {
  const { dataDir, sessionStorePath, tmpFile } = setup();
  try {
    const fake = new FakeProvider('claude', tmpFile, '');
    const driver = new SessionDriver(sessionStorePath, { providers: [fake] });
    const deviceKey = generateDeviceKey();
    const r = await driver.manualRefresh({ deviceKey, sessionId: 'not-a-real-id' });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.reason, 'no_session');
    }
  } finally {
    teardown(dataDir);
  }
});

// ──────────────────────────────────────────────────────────────────
// Automatic ticker
// ──────────────────────────────────────────────────────────────────

test('automatic ticker fires and applies deltas after the interval', async () => {
  const { dataDir, sessionStorePath, tmpFile } = setup();
  try {
    const fake = new FakeProvider('claude', tmpFile, '');
    const driver = new SessionDriver(sessionStorePath, {
      providers: [fake],
      tickIntervalMs: 80
    });
    const deviceKey = generateDeviceKey();
    const r = await driver.startSession({ deviceKey });
    if (!r.ok) throw new Error('open failed');

    // Let the first tick fire (it should be a no-op: baseline already
    // captured every file with its current size, and nothing has been
    // appended since).
    await sleep(120);

    // Now grow the file. The next tick should pick the new events up.
    fake.appendLine({
      tokens: 200,
      kind: 'input',
      model: 'gpt-4',
      ts: '2026-07-07T00:00:00.000Z'
    });
    await waitForLive(
      driver,
      r.response.sessionId,
      () => readLedger().player.qi > 0,
      1_500
    );
    assert.ok(readLedger().player.qi > 0, `qi=${readLedger().player.qi}`);
    driver.shutdown();
  } finally {
    teardown(dataDir);
  }
});

// ──────────────────────────────────────────────────────────────────
// Stop / shutdown
// ──────────────────────────────────────────────────────────────────

test('stopSession closes the session and clears the live timer', async () => {
  const { dataDir, sessionStorePath, tmpFile } = setup();
  try {
    const fake = new FakeProvider('claude', tmpFile, '');
    const driver = new SessionDriver(sessionStorePath, {
      providers: [fake],
      tickIntervalMs: 50
    });
    const deviceKey = generateDeviceKey();
    const r = await driver.startSession({ deviceKey });
    if (!r.ok) throw new Error('open failed');
    const sessionId = r.response.sessionId;

    const stopped = await driver.stopSession({ deviceKey, sessionId });
    assert.equal(stopped.ok, true);
    assert.equal(driver._isLive(sessionId), false);
    driver.shutdown();
  } finally {
    teardown(dataDir);
  }
});

test('shutdown clears every live session', async () => {
  const { dataDir, sessionStorePath, tmpFile } = setup();
  try {
    const fake = new FakeProvider('claude', tmpFile, '');
    const driver = new SessionDriver(sessionStorePath, { providers: [fake] });
    const k1 = generateDeviceKey();
    const k2 = generateDeviceKey();
    const a = await driver.startSession({ deviceKey: k1 });
    const b = await driver.startSession({ deviceKey: k2 });
    if (!a.ok || !b.ok) throw new Error('open failed');
    driver.shutdown();
    assert.equal(driver._isLive(a.response.sessionId), false);
    assert.equal(driver._isLive(b.response.sessionId), false);
  } finally {
    teardown(dataDir);
  }
});
