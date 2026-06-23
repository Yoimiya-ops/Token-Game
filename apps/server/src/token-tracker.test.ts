import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  getTokenTrackerSyncStatus,
  loadTokenTrackerEventsFromQueue,
  resolveTokenTrackerModule,
  syncTokenTrackerEvents
} from './token-tracker';
import { purgeMockEventsFromLedgerFile } from './store';

test('loads TokenTracker queue rows as normalized token events', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'token-game-token-tracker-'));
  const queuePath = path.join(dir, 'queue.jsonl');
  writeFileSync(
    queuePath,
    [
      JSON.stringify({
        source: 'codex',
        model: 'gpt-5.5',
        hour_start: '2026-06-17T06:00:00.000Z',
        input_tokens: 70,
        cached_input_tokens: 30,
        output_tokens: 25,
        reasoning_output_tokens: 5,
        total_tokens: 130
      }),
      ''
    ].join('\n')
  );

  const events = loadTokenTrackerEventsFromQueue(queuePath);

  assert.deepEqual(
    events.map((event) => [event.kind, event.tokenCount]),
    [
      ['input', 70],
      ['cached', 30],
      ['output', 25],
      ['reasoning', 5]
    ]
  );
  assert.equal(events.reduce((sum, event) => sum + event.tokenCount, 0), 130);
  assert.equal(events[0].source, 'tokentracker');
  assert.equal(events[0].model, 'gpt-5.5');
});

test('syncs only new TokenTracker bucket deltas into the game ledger', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'token-game-ledger-'));
  const ledgerPath = path.join(dir, 'ledger.json');
  const firstEvent = {
    id: 'tokentracker:codex:gpt-5.5:2026-06-17T06-00-00.000Z:input:70',
    source: 'tokentracker' as const,
    model: 'gpt-5.5',
    kind: 'input' as const,
    tokenCount: 70,
    occurredAt: '2026-06-17T06:00:00.000Z',
    metadata: {
      tracker: 'TokenTracker',
      bucketKey: 'codex|gpt-5.5|2026-06-17T06:00:00.000Z|input',
      trackerSource: 'codex'
    }
  };

  mkdirSync(dir, { recursive: true });
  syncTokenTrackerEvents({ ledgerPath, events: [firstEvent] });
  syncTokenTrackerEvents({ ledgerPath, events: [firstEvent] });

  const afterDuplicate = JSON.parse(readFileSync(ledgerPath, 'utf8'));
  assert.equal(afterDuplicate.player.totalTokens, 70);
  assert.equal(afterDuplicate.events.length, 1);

  syncTokenTrackerEvents({
    ledgerPath,
    events: [
      {
        ...firstEvent,
        id: 'tokentracker:codex:gpt-5.5:2026-06-17T06-00-00.000Z:input:120',
        tokenCount: 120
      }
    ]
  });

  const afterDelta = JSON.parse(readFileSync(ledgerPath, 'utf8'));
  assert.equal(afterDelta.player.totalTokens, 120);
  assert.equal(afterDelta.events[0].tokenCount, 50);
  assert.equal(afterDelta.trackerState.bucketTokens['codex|gpt-5.5|2026-06-17T06:00:00.000Z|input'], 120);
});

test('resolves bundled TokenTracker from the server package dependency tree', () => {
  const resolved = resolveTokenTrackerModule('tokentracker-cli/src/commands/sync');

  assert.match(resolved, /tokentracker-cli[\\/]+src[\\/]+commands[\\/]+sync\.js$/);
});

test('reports TokenTracker queue status for diagnostics', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'token-game-token-tracker-status-'));
  const queuePath = path.join(dir, 'queue.jsonl');
  writeFileSync(queuePath, '');

  const status = getTokenTrackerSyncStatus(queuePath);

  assert.equal(status.queuePath, queuePath);
  assert.equal(typeof status.queueUpdatedAt, 'string');
  assert.equal(status.lastError, null);
});

test('purges legacy mock events from an existing ledger', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'token-game-ledger-mock-purge-'));
  const ledgerPath = path.join(dir, 'ledger.json');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    ledgerPath,
    JSON.stringify({
      player: {
        kittenName: 'Mochi',
        food: 15,
        totalTokens: 150,
        lastFedAt: '2026-06-17T06:00:00.000Z',
        processorLevel: 0,
        lifetimeFoodSpent: 0
      },
      events: [
        {
          id: 'real',
          source: 'tokentracker',
          model: 'gpt-5.5',
          kind: 'input',
          tokenCount: 100,
          occurredAt: '2026-06-17T06:00:00.000Z',
          foodGained: 10
        },
        {
          id: 'mock',
          source: 'mock',
          model: 'gpt-5-mini',
          kind: 'output',
          tokenCount: 50,
          occurredAt: '2026-06-17T05:00:00.000Z',
          foodGained: 5
        }
      ],
      trackerState: {
        bucketTokens: {},
        lastSyncedAt: null
      }
    })
  );

  purgeMockEventsFromLedgerFile(ledgerPath);

  const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
  assert.equal(ledger.player.totalTokens, 100);
  assert.equal(ledger.player.qi, 10);
  assert.deepEqual(ledger.events.map((event: { id: string }) => event.id), ['real']);
});
