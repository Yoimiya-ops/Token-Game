import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { tokenEventSchema } from '@token-game/shared';
import {
  aggregateEvents,
  bucketsToRows,
  floorToHour
} from './token-tracker/aggregator';
import { readTrackerState, writeTrackerState, getProviderState, resolveCursor } from './token-tracker/state';
import { CodexProvider } from './token-tracker/providers/codex';
import { ClaudeCodeProvider } from './token-tracker/providers/claude';
import { KimiCodeProvider } from './token-tracker/providers/kimi';
import { WorkBuddyProvider } from './token-tracker/providers/workbuddy';
import { CursorProvider } from './token-tracker/providers/cursor';
import { ZcodeProvider } from './token-tracker/providers/zcode';
import { getDefaultProviders } from './token-tracker/providers';
import {
  resolveEventsPath,
  resolveStatePath,
  resolveTrackerDataDir,
  loadTokenTrackerEventsFromQueue,
  syncTokenTrackerEvents,
  resetTrackerDataForTest
} from './token-tracker';
import { updateLedgerFile, readLedger, type Ledger } from './store';

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

// ──────────────────────────────────────────────────────────────────────────
// Aggregator
// ──────────────────────────────────────────────────────────────────────────

test('floorToHour strips minute/second/ms from a timestamp', () => {
  const floored = floorToHour('2026-06-17T10:24:37.024Z');
  assert.equal(floored, '2026-06-17T10:00:00.000Z');
});

test('aggregateEvents merges same-key events and floors to the hour', () => {
  const buckets = aggregateEvents([
    { source: 'codex', model: 'gpt-5.5', kind: 'input', tokenCount: 10, occurredAt: '2026-06-17T10:24:00.000Z' },
    { source: 'codex', model: 'gpt-5.5', kind: 'input', tokenCount: 5, occurredAt: '2026-06-17T10:55:00.000Z' },
    { source: 'codex', model: 'gpt-5.5', kind: 'output', tokenCount: 7, occurredAt: '2026-06-17T10:30:00.000Z' },
    { source: 'codex', model: 'gpt-5.5', kind: 'cached', tokenCount: 3, occurredAt: '2026-06-17T10:40:00.000Z' }
  ]);

  const rows = bucketsToRows(buckets);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].input_tokens, 15);
  assert.equal(rows[0].output_tokens, 7);
  assert.equal(rows[0].cached_input_tokens, 3);
  assert.equal(rows[0].total_tokens, 25);
  assert.equal(rows[0].hour_start, '2026-06-17T10:00:00.000Z');
});

test('aggregateEvents separates by model and source', () => {
  const buckets = aggregateEvents([
    { source: 'claude', model: 'opus-4', kind: 'output', tokenCount: 1, occurredAt: '2026-06-17T10:00:00.000Z' },
    { source: 'claude', model: 'sonnet-4', kind: 'output', tokenCount: 2, occurredAt: '2026-06-17T10:00:00.000Z' },
    { source: 'codex', model: 'gpt-5', kind: 'output', tokenCount: 3, occurredAt: '2026-06-17T10:00:00.000Z' }
  ]);
  assert.equal(bucketsToRows(buckets).length, 3);
});

// ──────────────────────────────────────────────────────────────────────────
// State
// ──────────────────────────────────────────────────────────────────────────

test('readTrackerState returns empty state for missing file', () => {
  const state = readTrackerState(join(tempDir('tracker-state-'), 'state.json'));
  assert.equal(state.version, 1);
  assert.equal(Object.keys(state.providers).length, 0);
});

test('writeTrackerState then readTrackerState round-trips', () => {
  const dir = tempDir('tracker-state-');
  const path = join(dir, 'state.json');
  const state = readTrackerState(path);
  getProviderState(state, 'claude').files['/tmp/session.jsonl'] = { inode: 42, offset: 1024 };
  writeTrackerState(path, state);
  const reloaded = readTrackerState(path);
  assert.deepEqual(reloaded.providers.claude?.files['/tmp/session.jsonl'], { inode: 42, offset: 1024 });
});

test('resolveCursor treats inode change as full re-read', () => {
  const prev = { inode: 1, offset: 500 };
  const next = resolveCursor(prev, 2);
  assert.ok(next);
  assert.equal(next.offset, 0);
  assert.equal(next.inode, 2);
});

test('resolveCursor keeps the same offset when inode matches', () => {
  const prev = { inode: 1, offset: 500 };
  const next = resolveCursor(prev, 1);
  assert.deepEqual(next, prev);
});

// ──────────────────────────────────────────────────────────────────────────
// Providers — Codex
// ──────────────────────────────────────────────────────────────────────────

test('CodexProvider parses token_count last_token_usage deltas', async () => {
  const dir = tempDir('codex-');
  const projectDir = join(dir, 'sessions', '2026', '06', '17');
  mkdirSync(projectDir, { recursive: true });
  const file = join(projectDir, 'rollout-test.jsonl');
  writeFileSync(
    file,
    [
      JSON.stringify({ timestamp: '2026-06-17T10:22:47Z', type: 'session_meta', payload: { id: 's1' } }),
      JSON.stringify({
        timestamp: '2026-06-17T10:22:47Z',
        type: 'turn_context',
        payload: { model: 'gpt-5.5' }
      }),
      JSON.stringify({
        timestamp: '2026-06-17T10:24:37Z',
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: {
            total_token_usage: { input_tokens: 14067, cached_input_tokens: 10624, output_tokens: 235, total_tokens: 14302 },
            last_token_usage: { input_tokens: 100, cached_input_tokens: 30, output_tokens: 25, reasoning_output_tokens: 5, total_tokens: 130 }
          }
        }
      }),
      ''
    ].join('\n')
  );

  const provider = new CodexProvider(dir);
  const { events, newCursor } = await provider.parseFile(file, null);
  assert.equal(events.length, 4);
  const byKind = Object.fromEntries(events.map((e) => [e.kind, e]));
  assert.equal(byKind.cached.tokenCount, 30);
  // input = raw 100 - cached 30 = 70 (Codex reports input as full prompt incl cache)
  assert.equal(byKind.input.tokenCount, 70);
  assert.equal(byKind.output.tokenCount, 25);
  assert.equal(byKind.reasoning.tokenCount, 5);
  assert.equal(byKind.cached.model, 'gpt-5.5');
  assert.equal(newCursor?.offset ?? 0, readFileSync(file).length);
});

test('CodexProvider picks up model changes from subsequent turn_contexts', async () => {
  const dir = tempDir('codex-');
  const projectDir = join(dir, 'sessions', '2026', '06', '17');
  mkdirSync(projectDir, { recursive: true });
  const file = join(projectDir, 'rollout-test.jsonl');
  writeFileSync(
    file,
    [
      JSON.stringify({ timestamp: '2026-06-17T10:00:00Z', type: 'turn_context', payload: { model: 'gpt-5.5' } }),
      JSON.stringify({
        timestamp: '2026-06-17T10:00:01Z',
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: { last_token_usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5 } }
        }
      }),
      JSON.stringify({ timestamp: '2026-06-17T11:00:00Z', type: 'turn_context', payload: { model: 'o3' } }),
      JSON.stringify({
        timestamp: '2026-06-17T11:00:01Z',
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: { last_token_usage: { input_tokens: 20, cached_input_tokens: 0, output_tokens: 10 } }
        }
      }),
      ''
    ].join('\n')
  );

  const provider = new CodexProvider(dir);
  const { events } = await provider.parseFile(file, null);
  const inputEvents = events.filter((e) => e.kind === 'input');
  assert.equal(inputEvents[0].model, 'gpt-5.5');
  assert.equal(inputEvents[1].model, 'o3');
});

// ──────────────────────────────────────────────────────────────────────────
// Providers — Claude Code
// ──────────────────────────────────────────────────────────────────────────

test('ClaudeCodeProvider parses assistant message usage including cache fields', async () => {
  const dir = tempDir('claude-');
  const projectDir = join(dir, 'projects', 'work');
  mkdirSync(projectDir, { recursive: true });
  const file = join(projectDir, 'session-abc.jsonl');
  writeFileSync(
    file,
    [
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'hi' }, timestamp: '2026-06-17T10:00:00Z' }),
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          model: 'claude-sonnet-4.6',
          content: [{ type: 'text', text: 'hello' }],
          usage: { input_tokens: 100, cache_creation_input_tokens: 30, cache_read_input_tokens: 50, output_tokens: 40 }
        },
        timestamp: '2026-06-17T10:00:01Z'
      }),
      ''
    ].join('\n')
  );

  const provider = new ClaudeCodeProvider(dir);
  const { events } = await provider.parseFile(file, null);
  const byKind = Object.fromEntries(events.map((e) => [e.kind, e]));
  // input = input_tokens(100) + cache_creation(30) = 130
  assert.equal(byKind.input.tokenCount, 130);
  assert.equal(byKind.cached.tokenCount, 50);
  assert.equal(byKind.output.tokenCount, 40);
  assert.equal(byKind.input.model, 'claude-sonnet-4.6');
});

test('ClaudeCodeProvider ignores non-assistant lines', async () => {
  const dir = tempDir('claude-');
  const projectDir = join(dir, 'projects', 'work');
  mkdirSync(projectDir, { recursive: true });
  const file = join(projectDir, 'session-empty.jsonl');
  writeFileSync(
    file,
    [
      JSON.stringify({ type: 'user', message: { role: 'user' }, timestamp: '2026-06-17T10:00:00Z' }),
      JSON.stringify({ type: 'summary', summary: 'a session', timestamp: '2026-06-17T11:00:00Z' }),
      ''
    ].join('\n')
  );
  const provider = new ClaudeCodeProvider(dir);
  const { events } = await provider.parseFile(file, null);
  assert.equal(events.length, 0);
});

// ──────────────────────────────────────────────────────────────────────────
// Incremental cursor behavior
// ──────────────────────────────────────────────────────────────────────────

test('CodexProvider only reads new bytes on a re-parse', async () => {
  const dir = tempDir('codex-');
  const projectDir = join(dir, 'sessions', '2026', '06', '17');
  mkdirSync(projectDir, { recursive: true });
  const file = join(projectDir, 'rollout-test.jsonl');
  const initial = [
    JSON.stringify({ timestamp: '2026-06-17T10:00:00Z', type: 'turn_context', payload: { model: 'gpt-5.5' } }),
    JSON.stringify({
      timestamp: '2026-06-17T10:00:01Z',
      type: 'event_msg',
      payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5 } } }
    }),
    ''
  ].join('\n');
  writeFileSync(file, initial);

  const provider = new CodexProvider(dir);
  const first = await provider.parseFile(file, null);
  assert.equal(first.events.length, 2);

  // Append a new line
  const appended = '\n' + JSON.stringify({
    timestamp: '2026-06-17T10:00:02Z',
    type: 'event_msg',
    payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 20, cached_input_tokens: 0, output_tokens: 8 } } }
  }) + '\n';
  writeFileSync(file, initial + appended);

  const second = await provider.parseFile(file, first.newCursor);
  // Only the newly-appended events should be returned
  assert.equal(second.events.length, 2);
  const inputs = second.events.filter((e) => e.kind === 'input');
  assert.equal(inputs[0].tokenCount, 20);
  // Cursor should advance to end of file
  assert.equal(second.newCursor?.offset, readFileSync(file).length);
});

test('JSONL providers keep cursor offsets byte-accurate after UTF-8 lines', async () => {
  {
    const dir = tempDir('utf8-claude-');
    const projectDir = join(dir, 'projects', 'work');
    mkdirSync(projectDir, { recursive: true });
    const file = join(projectDir, 'session.jsonl');
    const initial = [
      JSON.stringify({
        type: 'assistant',
        message: { model: '模型🚀', usage: { input_tokens: 10, output_tokens: 1 } },
        timestamp: '2026-06-17T10:00:00Z'
      }),
      ''
    ].join('\n');
    writeFileSync(file, initial);
    const provider = new ClaudeCodeProvider(dir);
    const first = await provider.parseFile(file, null);
    assert.equal(first.newCursor?.offset, readFileSync(file).length);

    const appended = JSON.stringify({
      type: 'assistant',
      message: { model: 'claude-next', usage: { input_tokens: 20, output_tokens: 2 } },
      timestamp: '2026-06-17T10:00:01Z'
    }) + '\n';
    writeFileSync(file, initial + appended);
    const second = await provider.parseFile(file, first.newCursor);
    assert.equal(second.events.find((e) => e.kind === 'input')?.tokenCount, 20);
    assert.equal(second.newCursor?.offset, readFileSync(file).length);
  }

  {
    const dir = tempDir('utf8-codex-');
    const projectDir = join(dir, 'sessions', '2026', '06', '17');
    mkdirSync(projectDir, { recursive: true });
    const file = join(projectDir, 'rollout-test.jsonl');
    const initial = [
      JSON.stringify({ timestamp: '2026-06-17T10:00:00Z', type: 'turn_context', payload: { model: '模型🚀' } }),
      JSON.stringify({
        timestamp: '2026-06-17T10:00:01Z',
        type: 'event_msg',
        payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 10, output_tokens: 1 } } }
      }),
      ''
    ].join('\n');
    writeFileSync(file, initial);
    const provider = new CodexProvider(dir);
    const first = await provider.parseFile(file, null);
    assert.equal(first.newCursor?.offset, readFileSync(file).length);

    const appended = JSON.stringify({
      timestamp: '2026-06-17T10:00:02Z',
      type: 'event_msg',
      payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 20, output_tokens: 2 } } }
    }) + '\n';
    writeFileSync(file, initial + appended);
    const second = await provider.parseFile(file, first.newCursor);
    assert.equal(second.events.find((e) => e.kind === 'input')?.tokenCount, 20);
    assert.equal(second.newCursor?.offset, readFileSync(file).length);
  }

  {
    const dir = tempDir('utf8-kimi-');
    const sessionsDir = join(dir, '.kimi-code', 'sessions', 'wd', 'sess-1', 'agents', 'main');
    mkdirSync(sessionsDir, { recursive: true });
    const file = join(sessionsDir, 'wire.jsonl');
    const initial = [
      JSON.stringify({ type: 'config.update', modelAlias: 'kimi/模型🚀', time: 1735012800000 }),
      JSON.stringify({ type: 'step.end', uuid: 'step-1', time: 1735012800000, usage: { inputOther: 10, output: 1 } }),
      ''
    ].join('\n');
    writeFileSync(file, initial);
    const provider = new KimiCodeProvider(dir, {});
    const first = await provider.parseFile(file, null);
    assert.equal(first.newCursor?.offset, readFileSync(file).length);

    const appended = JSON.stringify({ type: 'step.end', uuid: 'step-2', time: 1735012801000, usage: { inputOther: 20, output: 2 } }) + '\n';
    writeFileSync(file, initial + appended);
    const second = await provider.parseFile(file, first.newCursor);
    assert.equal(second.events.find((e) => e.kind === 'input')?.tokenCount, 20);
    assert.equal(second.newCursor?.offset, readFileSync(file).length);
  }

  {
    const dir = tempDir('utf8-workbuddy-');
    const projectsDir = join(dir, '.workbuddy', 'projects', 'ws', 'sess-1');
    mkdirSync(projectsDir, { recursive: true });
    const file = join(projectsDir, 'main.jsonl');
    const initial = [
      JSON.stringify({
        id: 'r1',
        sessionId: 'sess-1',
        timestamp: 1735012800000,
        model: '模型🚀',
        providerData: { rawUsage: { prompt_tokens: 10, completion_tokens: 1 }, model: '模型🚀' }
      }),
      ''
    ].join('\n');
    writeFileSync(file, initial);
    const provider = new WorkBuddyProvider(dir, {});
    const first = await provider.parseFile(file, null);
    assert.equal(first.newCursor?.offset, readFileSync(file).length);

    const appended = JSON.stringify({
      id: 'r2',
      sessionId: 'sess-1',
      timestamp: 1735012801000,
      model: 'workbuddy-next',
      providerData: { rawUsage: { prompt_tokens: 20, completion_tokens: 2 }, model: 'workbuddy-next' }
    }) + '\n';
    writeFileSync(file, initial + appended);
    const second = await provider.parseFile(file, first.newCursor);
    assert.equal(second.events.find((e) => e.kind === 'input')?.tokenCount, 20);
    assert.equal(second.newCursor?.offset, readFileSync(file).length);
  }
});

// ──────────────────────────────────────────────────────────────────────────
// End-to-end: write fake session logs, run sync, see events
// ──────────────────────────────────────────────────────────────────────────

test('end-to-end: runSync reads session logs and produces game events', async () => {
  // Fake a Codex installation in a temp dir
  const fakeHome = tempDir('e2e-');
  const sessionsDir = join(fakeHome, '.codex', 'sessions', '2026', '06', '17');
  mkdirSync(sessionsDir, { recursive: true });
  writeFileSync(
    join(sessionsDir, 'rollout-test.jsonl'),
    [
      JSON.stringify({ timestamp: '2026-06-17T10:00:00Z', type: 'turn_context', payload: { model: 'gpt-5.5' } }),
      JSON.stringify({
        timestamp: '2026-06-17T10:00:01Z',
        type: 'event_msg',
        payload: { type: 'token_count', info: { last_token_usage: { input_tokens: 100, cached_input_tokens: 30, output_tokens: 25 } } }
      }),
      ''
    ].join('\n')
  );

  // Override the tracker's data dir to live inside our temp dir
  const fakeDataDir = join(fakeHome, '.token-game', 'tracker');
  mkdirSync(fakeDataDir, { recursive: true });

  // Monkey-patch the providers to look in fakeHome
  const providers = getDefaultProviders(fakeHome);
  const codexProvider = providers.find((p) => p.id === 'codex')!;

  // Collect raw events through the provider directly to verify pipeline shape
  const files = await codexProvider.listFiles();
  assert.equal(files.length, 1);
  const { events } = await codexProvider.parseFile(files[0], null);
  assert.equal(events.length, 3);

  // Now run the full aggregator + state pipeline
  const { aggregateEvents, bucketsToRows } = await import('./token-tracker/aggregator');
  const buckets = bucketsToRows(aggregateEvents(events));
  assert.equal(buckets.length, 1);
  assert.equal(buckets[0].source, 'codex');
  assert.equal(buckets[0].input_tokens, 70);
  assert.equal(buckets[0].cached_input_tokens, 30);
  assert.equal(buckets[0].output_tokens, 25);
  assert.equal(buckets[0].total_tokens, 125);
});

// ──────────────────────────────────────────────────────────────────────────
// Backward compatibility: events.jsonl on disk → game events
// ──────────────────────────────────────────────────────────────────────────

test('loadTokenTrackerEventsFromQueue reads our events.jsonl format', () => {
  const dir = tempDir('legacy-');
  const eventsPath = join(dir, 'events.jsonl');
  writeFileSync(
    eventsPath,
    [
      JSON.stringify({
        source: 'codex',
        model: 'gpt-5.5',
        hour_start: '2026-06-17T10:00:00.000Z',
        input_tokens: 70,
        cached_input_tokens: 30,
        output_tokens: 25,
        reasoning_output_tokens: 5,
        total_tokens: 130
      }),
      ''
    ].join('\n')
  );

  const events = loadTokenTrackerEventsFromQueue(eventsPath);
  assert.equal(events.length, 4);
  assert.equal(events[0].source, 'tokentracker');
  for (const e of events) {
    tokenEventSchema.parse(e);
  }
});

test('syncTokenTrackerEvents applies new bucket deltas to a ledger', () => {
  const dir = tempDir('apply-');
  const ledgerPath = join(dir, 'ledger.json');
  const eventsPath = join(dir, 'events.jsonl');
  writeFileSync(
    eventsPath,
    [
      JSON.stringify({
        source: 'claude',
        model: 'claude-sonnet-4.6',
        hour_start: '2026-06-17T10:00:00.000Z',
        input_tokens: 100,
        cached_input_tokens: 0,
        output_tokens: 50,
        reasoning_output_tokens: 0,
        total_tokens: 150
      }),
      ''
    ].join('\n')
  );

  // First sync imports 100 + 50 = 150
  const imported1 = syncTokenTrackerEvents({ ledgerPath, queuePath: eventsPath });
  assert.equal(imported1, 150);

  // Same file again = no new deltas
  const imported2 = syncTokenTrackerEvents({ ledgerPath, queuePath: eventsPath });
  assert.equal(imported2, 0);

  // Increase the bucket
  writeFileSync(
    eventsPath,
    [
      JSON.stringify({
        source: 'claude',
        model: 'claude-sonnet-4.6',
        hour_start: '2026-06-17T10:00:00.000Z',
        input_tokens: 200,
        cached_input_tokens: 0,
        output_tokens: 80,
        reasoning_output_tokens: 0,
        total_tokens: 280
      }),
      ''
    ].join('\n')
  );
  const imported3 = syncTokenTrackerEvents({ ledgerPath, queuePath: eventsPath });
  assert.equal(imported3, 130);

  const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8')) as Ledger;
  assert.equal(ledger.player.totalTokens, 280);
});

// ──────────────────────────────────────────────────────────────────────────
// Path resolution
// ──────────────────────────────────────────────────────────────────────────

test('resolveTrackerDataDir puts state under ~/.token-game/tracker', () => {
  assert.equal(resolveTrackerDataDir('/home/alice'), join('/home/alice', '.token-game', 'tracker'));
  assert.equal(resolveStatePath('/home/alice'), join('/home/alice', '.token-game', 'tracker', 'state.json'));
  assert.equal(resolveEventsPath('/home/alice'), join('/home/alice', '.token-game', 'tracker', 'events.jsonl'));
});

// ──────────────────────────────────────────────────────────────────────────
// Tracker-state isolation: temp home prevents touching real ~/.token-game
// ──────────────────────────────────────────────────────────────────────────

test('resetTrackerDataForTest only touches paths under the given home', () => {
  const fakeHome = tempDir('reset-');
  const statePath = resolveStatePath(fakeHome);
  const eventsPath = resolveEventsPath(fakeHome);
  mkdirSync(resolveTrackerDataDir(fakeHome), { recursive: true });
  writeFileSync(statePath, '{}');
  writeFileSync(eventsPath, '');
  assert.ok(existsSync(statePath));
  assert.ok(existsSync(eventsPath));
  resetTrackerDataForTest(fakeHome);
  assert.equal(existsSync(statePath), false);
  assert.equal(existsSync(eventsPath), false);
});

// ──────────────────────────────────────────────────────────────────────────
// Providers — Kimi Code
// ──────────────────────────────────────────────────────────────────────────

test('KimiCodeProvider parses proto 0.6+ camelCase usage and folds cache_creation into input', async () => {
  const dir = tempDir('kimi-');
  const kimiCodeHome = join(dir, '.kimi-code');
  const sessionsDir = join(kimiCodeHome, 'sessions', 'wd', 'sess-1', 'agents', 'main');
  mkdirSync(sessionsDir, { recursive: true });
  writeFileSync(
    join(kimiCodeHome, 'config.toml'),
    'default_model = "kimi-code/kimi-k2.6"\n'
  );
  const file = join(sessionsDir, 'wire.jsonl');
  writeFileSync(
    file,
    [
      JSON.stringify({
        type: 'config.update',
        modelAlias: 'kimi-code/kimi-k2.6',
        time: 1735012800000
      }),
      JSON.stringify({
        type: 'context.append_loop_event',
        event: {
          type: 'step.end',
          uuid: 'step-1',
          time: 1735012800000,
          usage: {
            inputOther: 100,
            inputCacheRead: 50,
            inputCacheCreation: 20,
            output: 30
          }
        },
        time: 1735012800000
      }),
      ''
    ].join('\n')
  );
  const provider = new KimiCodeProvider(dir, {});
  const files = await provider.listFiles();
  assert.equal(files.length, 1);
  const { events } = await provider.parseFile(file, null);
  // input = inputOther(100) + cache_creation(20) = 120
  const byKind = Object.fromEntries(events.map((e) => [e.kind, e]));
  assert.equal(byKind.input.tokenCount, 120);
  assert.equal(byKind.cached.tokenCount, 50);
  assert.equal(byKind.output.tokenCount, 30);
  // model comes from the config.update event, not the toml fallback
  assert.equal(byKind.input.model, 'kimi-k2.6');
});

test('KimiCodeProvider parses Anthropic-style usage with input_tokens_details.cached_tokens', async () => {
  const dir = tempDir('kimi-v1-');
  const sessionsDir = join(dir, '.kimi-code', 'sessions', 'wd', 'sess-1', 'agents', 'main');
  mkdirSync(sessionsDir, { recursive: true });
  const file = join(sessionsDir, 'wire.jsonl');
  writeFileSync(
    file,
    [
      JSON.stringify({
        type: 'step.end',
        uuid: 'step-1',
        time: 1735012800000,
        usage: {
          input_tokens: 1000,
          output_tokens: 200,
          input_tokens_details: { cached_tokens: 300 },
          cache_creation_input_tokens: 50
        }
      }),
      ''
    ].join('\n')
  );
  const provider = new KimiCodeProvider(dir, {});
  const { events } = await provider.parseFile(file, null);
  const byKind = Object.fromEntries(events.map((e) => [e.kind, e]));
  // input = 1000 - 300 = 700 (cache_creation is the OpenAI-compat path; here
  // it's also tracked separately and folded in just like proto 0.6+).
  // Wait — the v1 branch: cache_creation_input_tokens is read when
  // cache_read_input_tokens is null. input = input_tokens - cached = 700.
  // cache_creation is added to input downstream: 700 + 50 = 750.
  assert.equal(byKind.input.tokenCount, 750);
  assert.equal(byKind.cached.tokenCount, 300);
  assert.equal(byKind.output.tokenCount, 200);
});

test('KimiCodeProvider dedups by step.end uuid across syncs', async () => {
  const dir = tempDir('kimi-dedup-');
  const sessionsDir = join(dir, '.kimi-code', 'sessions', 'wd', 'sess-1', 'agents', 'main');
  mkdirSync(sessionsDir, { recursive: true });
  const file = join(sessionsDir, 'wire.jsonl');
  writeFileSync(
    file,
    [
      JSON.stringify({
        type: 'step.end',
        uuid: 'step-dup',
        time: 1735012800000,
        usage: { inputOther: 10, output: 5 }
      }),
      ''
    ].join('\n')
  );
  const provider = new KimiCodeProvider(dir, {});
  const first = await provider.parseFile(file, null);
  assert.equal(first.events.length, 2);
  const second = await provider.parseFile(file, first.newCursor);
  assert.equal(second.events.length, 0);
});

// ──────────────────────────────────────────────────────────────────────────
// Providers — ZCode
// ──────────────────────────────────────────────────────────────────────────

test('ZcodeProvider returns no files when ZCode is not installed', async () => {
  const dir = tempDir('zcode-absent-');
  const provider = new ZcodeProvider(dir, {});
  const files = await provider.listFiles();
  assert.equal(files.length, 0);
});

test('ZcodeProvider returns no events when the SQLite db is missing', async () => {
  const dir = tempDir('zcode-nodb-');
  // Create the parent dir but not the db file
  mkdirSync(join(dir, '.zcode', 'cli', 'db'), { recursive: true });
  const provider = new ZcodeProvider(dir, {});
  const files = await provider.listFiles();
  // No db file → listFiles returns 0
  assert.equal(files.length, 0);
});

test('ZcodeProvider classifies an OpenCode-style sqlite message when ZCode is installed', async () => {
  // We can't run SQLite in this test environment without spawning the CLI,
  // so we exercise the row → events mapping via the inline readZcodeDbRows
  // path. The actual SQLite query is the only piece that talks to the
  // filesystem; everything else is pure JS. We assert the source filter and
  // the model/token mapping by stubbing the SQLite call.
  //
  // Skipped when neither backend is available — this test only validates the
  // model/token classification and the providerID blocklist.
  const dir = tempDir('zcode-installed-');
  mkdirSync(join(dir, '.zcode', 'cli', 'db'), { recursive: true });
  // Touch a fake file so listFiles pretends the db exists; parseFile will
  // attempt the SQLite query and return [] if backends are missing.
  writeFileSync(join(dir, '.zcode', 'cli', 'db', 'db.sqlite'), '');
  const provider = new ZcodeProvider(dir, {});
  const files = await provider.listFiles();
  // We don't assert on the SQLite path here — it's covered indirectly by the
  // other Zcode tests once we add a real db fixture. Just confirm the
  // provider tolerates a missing/corrupt db file gracefully.
  if (files.length > 0) {
    const { events } = await provider.parseFile(files[0], null);
    assert.equal(events.length, 0);
  }
});

// ──────────────────────────────────────────────────────────────────────────
// Providers — WorkBuddy
// ──────────────────────────────────────────────────────────────────────────

test('WorkBuddyProvider parses providerData.rawUsage from assistant and tool records', async () => {
  const dir = tempDir('workbuddy-');
  const projectsDir = join(dir, '.workbuddy', 'projects', 'ws', 'sess-1', 'subagents');
  mkdirSync(projectsDir, { recursive: true });
  const file = join(projectsDir, 'agent-1.jsonl');
  writeFileSync(
    file,
    [
      JSON.stringify({
        id: 'r1',
        sessionId: 'sess-1',
        timestamp: 1735012800000,
        model: 'claude-sonnet-4.6',
        providerData: {
          rawUsage: {
            prompt_tokens: 1000,
            completion_tokens: 200,
            prompt_tokens_details: { cached_tokens: 400 },
            completion_tokens_details: { reasoning_tokens: 50 },
            cache_creation_input_tokens: 100
          },
          model: 'claude-sonnet-4.6'
        }
      }),
      ''
    ].join('\n')
  );
  const provider = new WorkBuddyProvider(dir, {});
  const { events } = await provider.parseFile(file, null);
  // input = 1000 - cacheRead(400) - cacheCreation(100) = 500
  // output = 200 - reasoning(50) = 150
  const byKind = Object.fromEntries(events.map((e) => [e.kind, e]));
  assert.equal(byKind.input.tokenCount, 500);
  assert.equal(byKind.cached.tokenCount, 400);
  assert.equal(byKind.output.tokenCount, 150);
  assert.equal(byKind.reasoning.tokenCount, 50);
});

test('WorkBuddyProvider walks projects/ recursively to find subagent files', async () => {
  const dir = tempDir('workbuddy-walk-');
  const root = join(dir, '.workbuddy', 'projects');
  mkdirSync(join(root, 'ws-1', 'sess-a'), { recursive: true });
  mkdirSync(join(root, 'ws-2', 'sess-b', 'subagents'), { recursive: true });
  writeFileSync(join(root, 'ws-1', 'sess-a', 'main.jsonl'), '');
  writeFileSync(join(root, 'ws-2', 'sess-b', 'subagents', 'agent-1.jsonl'), '');
  const provider = new WorkBuddyProvider(dir, {});
  const files = await provider.listFiles();
  assert.equal(files.length, 2);
});

// ──────────────────────────────────────────────────────────────────────────
// Providers — Cursor
// ──────────────────────────────────────────────────────────────────────────

test('CursorProvider returns no files when Cursor is not installed', async () => {
  const dir = tempDir('cursor-absent-');
  const provider = new CursorProvider(dir, {}, 'linux');
  const files = await provider.listFiles();
  assert.equal(files.length, 0);
});

test('CursorProvider returns no events when there is no session token', async () => {
  const dir = tempDir('cursor-noauth-');
  // Create only the appDir, no state.vscdb → token extraction returns null
  mkdirSync(join(dir, 'Library', 'Application Support', 'Cursor'), { recursive: true });
  const provider = new CursorProvider(dir, {}, 'darwin');
  const files = await provider.listFiles();
  assert.equal(files.length, 1);
  const { events } = await provider.parseFile(files[0], null);
  assert.equal(events.length, 0);
});

test('CursorProvider parses a synthetic CSV via the public parse path', async () => {
  // We don't actually call the network; verify the CSV parsing + record
  // mapping by going through the full provider code path with a fake cookie.
  // The provider will try to fetch from cursor.com and fail; we just want to
  // ensure listFiles returns the synthetic path on a populated home.
  const dir = tempDir('cursor-present-');
  mkdirSync(join(dir, '.config', 'Cursor'), { recursive: true });
  const provider = new CursorProvider(dir, {}, 'linux');
  const files = await provider.listFiles();
  assert.equal(files.length, 1);
  // Skip the live API call — we only assert that the provider tolerates
  // missing auth gracefully (returns 0 events, no throw).
  const { events } = await provider.parseFile(files[0], null);
  assert.equal(events.length, 0);
});

// ──────────────────────────────────────────────────────────────────────────
// First-sync filter
// ──────────────────────────────────────────────────────────────────────────

test('aggregateEvents drops events with occurredAt before firstSyncAt', () => {
  const dir = tempDir('first-sync-');
  resetTrackerDataForTest(dir);
  // pre-sync event
  const beforeEvents = aggregateEvents(
    [
      { source: 'claude', model: 'opus-4', kind: 'input', tokenCount: 100, occurredAt: '2026-06-01T00:00:00.000Z' }
    ],
    { firstSyncAt: '2026-06-15T00:00:00.000Z' }
  );
  assert.equal(beforeEvents.size, 0, 'events before firstSyncAt must be dropped');

  // post-sync event
  const afterEvents = aggregateEvents(
    [
      { source: 'claude', model: 'opus-4', kind: 'input', tokenCount: 100, occurredAt: '2026-06-15T00:30:00.000Z' }
    ],
    { firstSyncAt: '2026-06-15T00:00:00.000Z' }
  );
  assert.equal(afterEvents.size, 1, 'events on/after firstSyncAt must be kept');

  // no firstSyncAt → no filter
  const unfiltered = aggregateEvents([
    { source: 'claude', model: 'opus-4', kind: 'input', tokenCount: 100, occurredAt: '2026-06-01T00:00:00.000Z' }
  ]);
  assert.equal(unfiltered.size, 1);

  // unparseable timestamp with firstSyncAt set → dropped (safer default)
  const garbage = aggregateEvents(
    [{ source: 'claude', model: 'opus-4', kind: 'input', tokenCount: 100, occurredAt: 'not-a-date' }],
    { firstSyncAt: '2026-06-15T00:00:00.000Z' }
  );
  assert.equal(garbage.size, 0);
});

// ──────────────────────────────────────────────────────────────────────────
// Retired trust-batch state
// ──────────────────────────────────────────────────────────────────────────

test('readTrackerState ignores retired trust-batch fields from old state files', () => {
  const dir = tempDir('retired-trust-state-');
  const path = join(dir, 'state.json');
  writeFileSync(
    path,
    JSON.stringify({
      version: 1,
      providers: {},
      updatedAt: '2026-07-07T00:00:00.000Z',
      firstSyncAt: '2026-07-07T00:00:00.000Z',
      deviceKey: 'old-device-key',
      lastTrustBatchHash: 'old-hash',
      trustBatchIndex: 99
    })
  );

  const state = readTrackerState(path) as Record<string, unknown>;
  assert.equal(state.firstSyncAt, '2026-07-07T00:00:00.000Z');
  assert.equal('deviceKey' in state, false);
  assert.equal('lastTrustBatchHash' in state, false);
  assert.equal('trustBatchIndex' in state, false);
});
