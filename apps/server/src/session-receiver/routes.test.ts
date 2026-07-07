/**
 * Session-receiver: HTTP routes integration tests.
 *
 * Run with: `corepack pnpm --filter @token-game/server test`
 *
 * Focus: prove the routes delegate to the SessionDriver when one is
 * mounted, so the live ticker is scheduled and manual-refresh can find
 * the session. This was the integration gap that Wave 4.4 desktop smoke
 * caught: POST /v1/sessions used to write to the store directly without
 * notifying the SessionDriver, leaving its live map empty and breaking
 * manual-refresh with `no_session`.
 */

import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createGameApp } from '../index';
import { SessionDriver } from '../token-tracker/session-driver';
import type { Provider } from '../token-tracker/providers/base';
import type { FileCursor, RawEvent } from '../token-tracker/types';
import { ensureLedger, writeLedger } from '../store';

/** Mirror of the FakeProvider used in session-driver.test.ts so we
 *  don't have to pull in real provider parsing rules for a route test. */
class StubProvider implements Provider {
  readonly id: 'claude' | 'codex' | 'kimi-code' | 'workbuddy' | 'cursor' | 'zcode';
  readonly displayName: string;
  readonly path: string;
  private content = '';
  parseCalls = 0;

  constructor(id: 'claude' | 'codex' | 'kimi-code' | 'workbuddy' | 'cursor' | 'zcode', path: string) {
    this.id = id;
    this.displayName = id;
    this.path = path;
  }

  setContent(next: string) {
    this.content = next;
  }

  async listFiles(): Promise<string[]> {
    return [this.path];
  }

  async parseFile(
    _filePath: string,
    prevCursor: FileCursor | null
  ): Promise<{ events: RawEvent[]; newCursor: FileCursor | null }> {
    this.parseCalls += 1;
    const startOffset = prevCursor?.offset ?? 0;
    const slice = this.content.slice(startOffset);
    const lines = slice.split(/\r?\n/);
    const events: RawEvent[] = [];
    let consumedBytes = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const isLast = i === lines.length - 1;
      if (isLast && line.length > 0 && !slice.endsWith('\n')) break;
      if (line.length > 0) {
        consumedBytes += Buffer.byteLength(line, 'utf8') + 1;
      }
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line) as {
          tokens: number;
          kind: 'input' | 'cached' | 'output' | 'reasoning';
          model: string;
          ts: string;
        };
        events.push({
          source: this.id,
          tokenCount: obj.tokens,
          kind: obj.kind,
          model: obj.model,
          occurredAt: obj.ts
        });
      } catch {
        // skip malformed
      }
    }
    const newCursor: FileCursor = {
      offset: startOffset + consumedBytes,
      inode: 1
    };
    return { events, newCursor };
  }
}

async function postJson(
  app: Awaited<ReturnType<typeof createGameApp>>,
  url: string,
  body: unknown
): Promise<{ status: number; payload: Record<string, unknown> }> {
  const res = await app.inject({
    method: 'POST',
    url,
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify(body)
  });
  return { status: res.statusCode, payload: res.json() as Record<string, unknown> };
}

function resetLedgerInDataDir(dataDir: string) {
  process.env.TOKEN_GAME_DATA_DIR = dataDir;
  ensureLedger();
  writeLedger({
    version: 1,
    player: {
      kittenName: 'route-test',
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
    } as never,
    events: [],
    trackerState: { bucketTokens: {}, lastSyncedAt: null, kindlingBackfilledAt: null },
    homestead: {
      omen: null,
      treasureBasin: { dayKey: null, dailyCondenses: 0, lastCondensedAt: null },
      spiritBeast: { name: '', status: 'idle', route: null, lastDispatchedAt: null, returnsAt: null },
      inventory: [],
      logs: []
    }
  } as never);
}

test('POST /v1/sessions with mounted SessionDriver registers the live session', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'tg-routes-'));
  mkdirSync(dataDir, { recursive: true });
  resetLedgerInDataDir(dataDir);
  try {
    const provider = new StubProvider('claude', '/tmp/stub/session.jsonl');
    provider.setContent('');

    const driver = new SessionDriver(join(dataDir, 'sessions.json'), {
      providers: [provider],
      tickIntervalMs: 60_000
    });

    const app = await createGameApp({
      sessionStorePath: join(dataDir, 'sessions.json'),
      sessionDriver: driver,
      sessionDriverTickIntervalMs: 60_000,
      staticRoot: dataDir
    });

    const open = await postJson(app, '/v1/sessions', { clientLabel: 'test' });
    assert.equal(open.status, 200, JSON.stringify(open.payload));
    const opened = open.payload as unknown as { deviceKey: string; sessionId: string };
    assert.ok(opened.deviceKey.length >= 32);
    assert.ok(opened.sessionId.length > 0);

    // Without a driver registration, manual-refresh would 409 with
    // no_session. This is the bug Wave 4.4 desktop smoke exposed.
    assert.equal(
      driver._isLive(opened.sessionId),
      true,
      'SessionDriver did not capture the freshly opened session'
    );

    // Append a fake line and run manual-refresh. The driver should
    // scan the file, see the new bytes, and apply a bucket delta.
    provider.setContent(
      JSON.stringify({
        tokens: 100,
        kind: 'input',
        model: 'claude-stub-model',
        ts: new Date().toISOString()
      }) + '\n'
    );
    const refresh = await postJson(
      app,
      `/v1/sessions/${opened.deviceKey}/manual-refresh`,
      {}
    );
    assert.equal(refresh.status, 200, JSON.stringify(refresh.payload));
    const refreshed = refresh.payload as unknown as {
      ok: boolean;
      triggersAppliedBySource?: Record<string, number>;
      qiGained: number;
    };
    assert.equal(refreshed.ok, true);
    assert.deepEqual(refreshed.triggersAppliedBySource, { claude: 100 });
    assert.ok(refreshed.qiGained > 0);

    await app.close();
  } finally {
    try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
  }
});

test('POST /v1/sessions without a SessionDriver still opens a session (fallback path)', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'tg-routes-fallback-'));
  mkdirSync(dataDir, { recursive: true });
  resetLedgerInDataDir(dataDir);
  try {
    const app = await createGameApp({
      sessionStorePath: join(dataDir, 'sessions.json'),
      enableSessionDriver: false,
      staticRoot: dataDir
    });

    const open = await postJson(app, '/v1/sessions', { clientLabel: 'fallback-test' });
    assert.equal(open.status, 200, JSON.stringify(open.payload));
    const opened = open.payload as unknown as { deviceKey: string; sessionId: string };
    assert.ok(opened.deviceKey.length >= 32);

    // manual-refresh is gated on the driver; with none mounted it must
    // return 503 session_driver_disabled, not crash.
    const refresh = await postJson(
      app,
      `/v1/sessions/${opened.deviceKey}/manual-refresh`,
      {}
    );
    assert.equal(refresh.status, 503);
    await app.close();
  } finally {
    try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
  }
});

test('POST /v1/sessions refuses to open a second session for the same device', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'tg-routes-dup-'));
  mkdirSync(dataDir, { recursive: true });
  resetLedgerInDataDir(dataDir);
  try {
    const driver = new SessionDriver(join(dataDir, 'sessions.json'), {
      providers: [new StubProvider('claude', '/tmp/stub/session.jsonl')],
      tickIntervalMs: 60_000
    });

    const app = await createGameApp({
      sessionStorePath: join(dataDir, 'sessions.json'),
      sessionDriver: driver,
      staticRoot: dataDir
    });

    const first = await postJson(app, '/v1/sessions', { clientLabel: 'dup' });
    assert.equal(first.status, 200);
    const opened = first.payload as unknown as { deviceKey: string; sessionId: string };

    const second = await postJson(app, '/v1/sessions', { deviceKey: opened.deviceKey });
    assert.equal(second.status, 409);
    assert.equal(second.payload.error, 'session_already_open');

    await app.close();
  } finally {
    try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
  }
});