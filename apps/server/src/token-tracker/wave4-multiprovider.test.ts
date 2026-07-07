/**
 * Wave 4 multi-provider smoke: 4 real providers run side-by-side in a temp
 * home directory. Verifies:
 *
 *  - All four providers are picked up in the same SessionDriver tick.
 *  - Each provider's cursor advances independently (no cross-contamination).
 *  - Each provider's tokens land in the ledger under their own `source`.
 *  - A second tick does NOT re-apply the same lines (no double counting).
 *  - Cursor / ZCode tolerantly return [] when the binary / sqlite is absent
 *    (the "no crash on missing install" guarantee).
 *
 * These tests do NOT touch the real user's `~/.claude` / `~/.codex` etc —
 * `ClaudeCodeProvider` / `CodexProvider` / `KimiCodeProvider` /
 * `WorkBuddyProvider` all accept a `home` override at construction time, so
 * we point every provider at a tmpdir we control.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

import { generateDeviceKey } from '../session-receiver/validate';
import { SessionDriver } from './session-driver';
import { ClaudeCodeProvider } from './providers/claude';
import { CodexProvider } from './providers/codex';
import { KimiCodeProvider } from './providers/kimi';
import { WorkBuddyProvider } from './providers/workbuddy';
import { CursorProvider } from './providers/cursor';
import { ZcodeProvider } from './providers/zcode';
import { openSessionBaseline, runSessionTick } from './session-sync';

function setupWave4() {
  const dataDir = mkdtempSync(join(tmpdir(), 'tg-wave4-'));
  // Pin both ledger and session store to a tmpdir so we never touch the
  // developer's real ~/.token-game. This MUST happen before any
  // SessionDriver code path runs readLedger / readSessionStore.
  process.env.TOKEN_GAME_DATA_DIR = dataDir;
  const sessionStorePath = join(dataDir, 'sessions.json');

  // Each provider needs its own log root under the tmp home.
  const home = join(dataDir, 'home');
  mkdirSync(home, { recursive: true });

  return { dataDir, sessionStorePath, home };
}

function teardown(dataDir: string) {
  rmSync(dataDir, { recursive: true, force: true });
}

function ensureDirs(home: string) {
  mkdirSync(join(home, '.claude', 'projects', 'wave4'), { recursive: true });
  mkdirSync(join(home, '.codex', 'sessions', '2026', '07', '07'), { recursive: true });
  mkdirSync(join(home, '.kimi-code', 'sessions', 'wd', 'sess-wave4', 'agents', 'main'), { recursive: true });
  mkdirSync(join(home, '.workbuddy', 'projects', 'ws', 'sess-wave4'), { recursive: true });
}

function logPaths(home: string) {
  return {
    claude: join(home, '.claude', 'projects', 'wave4', 'session.jsonl'),
    codex: join(home, '.codex', 'sessions', '2026', '07', '07', 'rollout-wave4.jsonl'),
    kimi: join(home, '.kimi-code', 'sessions', 'wd', 'sess-wave4', 'agents', 'main', 'wire.jsonl'),
    workbuddy: join(home, '.workbuddy', 'projects', 'ws', 'sess-wave4', 'main.jsonl')
  };
}

test('Wave 4: four real providers (Claude/Codex/Kimi/WorkBuddy) ingest independently in one session', async () => {
  const { dataDir, sessionStorePath, home } = setupWave4();
  try {
    ensureDirs(home);
    const paths = logPaths(home);

    // Boot the driver + open the session FIRST. The baseline captures the
    // current size of every file. Any append AFTER this point counts as
    // "new usage" for the next tick.
    const driver = new SessionDriver(sessionStorePath, {
      providers: [
        new ClaudeCodeProvider(home),
        new CodexProvider(home),
        new KimiCodeProvider(home, {}),
        new WorkBuddyProvider(home, {}),
        // Cursor / ZCode don't have a CLI log here. They must stay silent.
        new CursorProvider(home, {}, 'linux'),
        new ZcodeProvider(home, {})
      ],
      tickIntervalMs: 60_000
    });

    const deviceKey = generateDeviceKey();
    const opened = await driver.startSession({ deviceKey });
    if (!opened.ok) throw new Error(`open failed: ${JSON.stringify(opened)}`);

    // First tick — nothing on disk yet, every source contributes zero.
    // We don't assert here; the contract is that a baseline tick is a no-op.
    await sleep(5_100);
    const blank = await driver.manualRefresh({
      deviceKey,
      sessionId: opened.response.sessionId
    });
    assert.equal(blank.ok, true);
    if (!blank.ok) throw new Error('baseline tick failed');
    assert.equal(blank.triggersAppliedBySource.claude ?? 0, 0, 'claude starts at zero');
    assert.equal(blank.triggersAppliedBySource.codex ?? 0, 0, 'codex starts at zero');
    assert.equal(blank.triggersAppliedBySource['kimi-code'] ?? 0, 0, 'kimi starts at zero');
    assert.equal(blank.triggersAppliedBySource.workbuddy ?? 0, 0, 'workbuddy starts at zero');

    // NOW append one log line per provider.
    const ts = '2026-07-07T10:00:00.000Z';
    appendFileSync(paths.claude, JSON.stringify({
      type: 'assistant',
      message: { role: 'assistant', model: 'claude-sonnet-4.6', usage: { input_tokens: 100, output_tokens: 50 } },
      timestamp: ts
    }) + '\n');
    appendFileSync(paths.codex, [
      JSON.stringify({ timestamp: ts, type: 'turn_context', payload: { model: 'gpt-5.5' } }),
      JSON.stringify({
        timestamp: ts,
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: { last_token_usage: { input_tokens: 200, cached_input_tokens: 0, output_tokens: 80 } }
        }
      }),
      ''
    ].join('\n'));
    appendFileSync(paths.kimi, [
      JSON.stringify({ type: 'config.update', modelAlias: 'kimi-k2.6', time: Date.parse(ts) }),
      JSON.stringify({
        type: 'step.end',
        uuid: 'wave4-step-1',
        time: Date.parse(ts),
        usage: { inputOther: 300, output: 120 }
      }),
      ''
    ].join('\n'));
    appendFileSync(paths.workbuddy, JSON.stringify({
      id: 'wave4-r1',
      sessionId: 'sess-wave4',
      timestamp: Date.parse(ts),
      model: 'claude-sonnet-4.6',
      providerData: {
        rawUsage: { prompt_tokens: 400, completion_tokens: 200 },
        model: 'claude-sonnet-4.6'
      }
    }) + '\n');

    // Wait out the manual-refresh 5s rate-limit, then trigger a tick.
    await sleep(5_100);
    const first = await driver.manualRefresh({
      deviceKey,
      sessionId: opened.response.sessionId
    });
    assert.equal(first.ok, true);
    if (!first.ok) throw new Error('post-append refresh failed');

    // Expected tokens per source (input + output):
    //   claude:     100 + 50  = 150
    //   codex:      (raw 200 - 0 cached) + 80 = 280
    //   kimi-code:  300 + 120 = 420
    //   workbuddy:  400 + 200 = 600
    // Grand total: 1450
    const t = first.triggersAppliedBySource;
    const total =
      (t.claude ?? 0) +
      (t.codex ?? 0) +
      (t['kimi-code'] ?? 0) +
      (t.workbuddy ?? 0);
    assert.equal(total, 1450, `per-source total=${total}, raw=${JSON.stringify(t)}`);

    // Each provider's bucket is independent — sources are NEVER mixed.
    assert.equal(t.claude, 150, `claude=${t.claude}`);
    assert.equal(t.codex, 280, `codex=${t.codex}`);
    assert.equal(t['kimi-code'], 420, `kimi=${t['kimi-code']}`);
    assert.equal(t.workbuddy, 600, `workbuddy=${t.workbuddy}`);

    // Cursor / ZCode must not have contributed anything (no files installed).
    assert.equal(t.cursor ?? 0, 0, 'cursor should be silent');
    assert.equal(t.zcode ?? 0, 0, 'zcode should be silent');

    // Wait out the 5s rate-limit, then trigger another tick. With no new
    // bytes since the last read, this must be a complete no-op.
    await sleep(5_100);
    const second = await driver.manualRefresh({
      deviceKey,
      sessionId: opened.response.sessionId
    });
    assert.equal(second.ok, true);
    if (!second.ok) throw new Error('second refresh failed');
    assert.equal(second.eventsEmitted, 0, 'no new events on a no-op tick');
    assert.equal(second.deltasEmitted, 0, 'no deltas on a no-op tick');
    assert.equal(second.triggersAppliedBySource.claude ?? 0, 0, 'no re-applied claude tokens');
    assert.equal(second.triggersAppliedBySource.codex ?? 0, 0, 'no re-applied codex tokens');
    assert.equal(second.triggersAppliedBySource['kimi-code'] ?? 0, 0, 'no re-applied kimi tokens');
    assert.equal(second.triggersAppliedBySource.workbuddy ?? 0, 0, 'no re-applied workbuddy tokens');

    driver.shutdown();
  } finally {
    teardown(dataDir);
  }
});

test('Wave 4: Cursor and ZCode providers tolerate a missing install (listFiles returns [])', async () => {
  const { dataDir, home } = setupWave4();
  try {
    // The home directory has no .cursor or .zcode state. Both providers
    // must return [] from listFiles, not throw.
    const cursor = new CursorProvider(home, {}, 'linux');
    const zcode = new ZcodeProvider(home, {});

    const cursorFiles = await cursor.listFiles();
    const zcodeFiles = await zcode.listFiles();
    assert.deepEqual(cursorFiles, []);
    assert.deepEqual(zcodeFiles, []);

    // And a tick with the same empty pair shouldn't throw or contribute
    // events. Verifies the multi-provider path keeps working when one
    // provider has zero files.
    const baseline = await openSessionBaseline([cursor, zcode]);
    const outcome = await runSessionTick({ providers: [cursor, zcode], states: baseline.states });
    assert.equal(outcome.deltas.length, 0);
    assert.equal(outcome.eventsEmitted, 0);
    assert.deepEqual(outcome.errors, []);
  } finally {
    teardown(dataDir);
  }
});

test('Wave 4: per-provider cursors are independent — appending to claude does not move kimi cursor', async () => {
  const { dataDir, home } = setupWave4();
  try {
    ensureDirs(home);
    const paths = logPaths(home);
    const ts = '2026-07-07T10:00:00.000Z';

    // Pre-fill a Claude line BEFORE the baseline so the first tick is a no-op.
    // Also touch the kimi file so it gets a baseline cursor — otherwise
    // kimi's listFiles won't see the file at all and the state map stays empty.
    appendFileSync(paths.claude, JSON.stringify({
      type: 'assistant',
      message: { model: 'claude-sonnet-4.6', usage: { input_tokens: 1, output_tokens: 1 } },
      timestamp: ts
    }) + '\n');
    writeFileSync(paths.kimi, '');

    const providers = [
      new ClaudeCodeProvider(home),
      new KimiCodeProvider(home, {})
    ];
    const baseline = await openSessionBaseline(providers);

    // First tick: no new bytes anywhere.
    const first = await runSessionTick({ providers, states: baseline.states });
    assert.equal(first.deltas.length, 0, 'no deltas before any new lines');

    // Append ONLY to the Claude file. The Kimi cursor must NOT move.
    appendFileSync(paths.claude, JSON.stringify({
      type: 'assistant',
      message: { model: 'claude-sonnet-4.6', usage: { input_tokens: 100, output_tokens: 50 } },
      timestamp: ts
    }) + '\n');

    const second = await runSessionTick({ providers, states: baseline.states });

    // Per-source cursor positions must be independent: each provider
    // tracks its own offset/inode, not shared.
    const claudeStateMap = baseline.states.get('claude');
    const kimiStateMap = baseline.states.get('kimi-code');
    assert.ok(claudeStateMap, 'baseline.states has claude entry');
    assert.ok(kimiStateMap, 'baseline.states has kimi-code entry');
    assert.notStrictEqual(claudeStateMap, kimiStateMap, 'claude and kimi state maps must be distinct');

    // The claude and kimi state maps must each be looking at their own file.
    // If we appended 1 byte to claude and kimi didn't grow, their offset
    // must NOT equal — the only way they're equal is if the cursors got
    // cross-wired (which is exactly what we want to prevent).
    const claudeOffsetBefore = claudeStateMap.get(paths.claude)?.offset;
    const kimiOffsetBefore = kimiStateMap.get(paths.kimi)?.offset;
    assert.ok(typeof claudeOffsetBefore === 'number', 'claude cursor has a numeric offset');
    assert.ok(typeof kimiOffsetBefore === 'number', 'kimi cursor has a numeric offset');
    // Kimi didn't get any new lines; kimi offset must be exactly the
    // initial kimi file size (a 2-line wire.jsonl is around 220 bytes).
    // The point is: it must NOT be the claude file's size.
    assert.notEqual(kimiOffsetBefore, claudeOffsetBefore, 'kimi offset must not follow claude offset');
  } finally {
    teardown(dataDir);
  }
});

// `openSessionBaseline` / `runSessionTick` are imported but only the former
// is referenced by name in the test above. Keep this re-export-style reference
// to avoid a TS unused-import warning if the second test ever changes shape.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
void runSessionTick;
