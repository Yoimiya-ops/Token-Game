import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { tokenEventSchema, tokenEventToQi, type TokenEvent } from '@token-game/shared';
import { applyStoredEvent, updateLedger, updateLedgerFile, type Ledger } from './store';

type QueueRow = {
  source?: string;
  model?: string;
  hour_start?: string;
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
  total_tokens?: number;
};

type TokenPart = {
  kind: TokenEvent['kind'];
  tokenCount: number;
};

type SyncOptions = {
  events?: TokenEvent[];
  ledgerPath?: string;
  queuePath?: string;
  runExternalSync?: boolean;
};

const TOKEN_TRACKER_NAME = 'TokenTracker';
const DEFAULT_SYNC_INTERVAL_MS = 30_000;
let lastExternalSyncAt = 0;
let externalSyncInFlight: Promise<void> | null = null;

function createPackageRequire() {
  const packageJsonPaths = [
    typeof __dirname === 'string' ? path.resolve(__dirname, '..', '..', '..', 'package.json') : '',
    path.resolve(process.cwd(), 'package.json')
  ].filter(Boolean);

  const packageJsonPath = packageJsonPaths.find((candidate) => existsSync(candidate)) ?? packageJsonPaths[0];
  return createRequire(packageJsonPath);
}

function positiveInteger(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function safeIdPart(value: string) {
  return value.replace(/[^a-zA-Z0-9.-]/g, '-');
}

function normalizeQueueRow(row: QueueRow) {
  const inputTokens = positiveInteger(row.input_tokens);
  const cachedTokens = positiveInteger(row.cached_input_tokens);
  const outputTokens = positiveInteger(row.output_tokens);
  const totalTokens = positiveInteger(row.total_tokens);

  if (
    (row.source === 'codex' || row.source === 'every-code') &&
    cachedTokens > 0 &&
    inputTokens >= cachedTokens &&
    totalTokens === inputTokens + outputTokens
  ) {
    return {
      ...row,
      input_tokens: inputTokens - cachedTokens
    };
  }

  return row;
}

function tokenParts(row: QueueRow): TokenPart[] {
  return [
    { kind: 'input' as const, tokenCount: positiveInteger(row.input_tokens) },
    { kind: 'cached' as const, tokenCount: positiveInteger(row.cached_input_tokens) },
    { kind: 'output' as const, tokenCount: positiveInteger(row.output_tokens) },
    { kind: 'reasoning' as const, tokenCount: positiveInteger(row.reasoning_output_tokens) }
  ].filter((part) => part.tokenCount > 0);
}

function bucketKey(row: QueueRow, kind: TokenEvent['kind']) {
  return `${row.source ?? 'unknown'}|${row.model ?? 'unknown'}|${row.hour_start ?? ''}|${kind}`;
}

function eventId(row: QueueRow, kind: TokenEvent['kind'], tokenCount: number) {
  return [
    'tokentracker',
    safeIdPart(row.source ?? 'unknown'),
    safeIdPart(row.model ?? 'unknown'),
    safeIdPart(row.hour_start ?? 'unknown-hour'),
    kind,
    tokenCount
  ].join(':');
}

export function resolveTokenTrackerQueuePath(home = homedir()) {
  return path.join(home, '.tokentracker', 'tracker', 'queue.jsonl');
}

export function loadTokenTrackerEventsFromQueue(queuePath = resolveTokenTrackerQueuePath()) {
  if (!existsSync(queuePath)) {
    return [];
  }

  const rows = new Map<string, QueueRow>();
  const lines = readFileSync(queuePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }

    try {
      const row = normalizeQueueRow(JSON.parse(line) as QueueRow);
      const key = `${row.source ?? ''}|${row.model ?? ''}|${row.hour_start ?? ''}`;
      rows.set(key, row);
    } catch {
      // TokenTracker's queue is append-only; ignore a partial/corrupt line and keep good rows.
    }
  }

  const events: TokenEvent[] = [];
  for (const row of rows.values()) {
    if (!row.hour_start) {
      continue;
    }

    for (const part of tokenParts(row)) {
      events.push(
        tokenEventSchema.parse({
          id: eventId(row, part.kind, part.tokenCount),
          source: 'tokentracker',
          model: row.model ?? 'unknown',
          kind: part.kind,
          tokenCount: part.tokenCount,
          occurredAt: row.hour_start,
          metadata: {
            tracker: TOKEN_TRACKER_NAME,
            trackerSource: row.source ?? 'unknown',
            bucketKey: bucketKey(row, part.kind)
          }
        })
      );
    }
  }

  return events;
}

function qiGainedFor(deltaEvent: TokenEvent, realmLevel: number) {
  return tokenEventToQi(deltaEvent.tokenCount) + realmLevel * 2;
}

function applyTrackerEvents(ledger: Ledger, events: TokenEvent[]) {
  let imported = 0;
  const bucketTokens = ledger.trackerState.bucketTokens;

  for (const event of events) {
    const key =
      typeof event.metadata?.bucketKey === 'string'
        ? event.metadata.bucketKey
        : `${event.source}|${event.model}|${event.occurredAt}|${event.kind}`;
    const previousTokenCount = positiveInteger(bucketTokens[key]);
    if (event.tokenCount <= previousTokenCount) {
      continue;
    }

    const delta = event.tokenCount - previousTokenCount;
    const deltaEvent = {
      ...event,
      id: `${event.id}:delta-${delta}`,
      tokenCount: delta,
      qiGained: qiGainedFor({ ...event, tokenCount: delta }, ledger.player.realmLevel)
    };

    applyStoredEvent(ledger, deltaEvent);
    bucketTokens[key] = event.tokenCount;
    imported += delta;
  }

  ledger.trackerState.lastSyncedAt = new Date().toISOString();
  return imported;
}

export function syncTokenTrackerEvents(options: SyncOptions = {}) {
  const events = options.events ?? loadTokenTrackerEventsFromQueue(options.queuePath);
  let imported = 0;

  if (options.ledgerPath) {
    updateLedgerFile(options.ledgerPath, (ledger) => {
      imported = applyTrackerEvents(ledger, events);
    });
    return imported;
  }

  updateLedger((ledger) => {
    imported = applyTrackerEvents(ledger, events);
  });
  return imported;
}

export async function runTokenTrackerSyncIfNeeded(now = Date.now()) {
  if (now - lastExternalSyncAt < DEFAULT_SYNC_INTERVAL_MS) {
    return;
  }

  if (!externalSyncInFlight) {
    externalSyncInFlight = runTokenTrackerSync()
      .catch(() => {
        // The game can still use the last queue snapshot if TokenTracker is not installed yet.
      })
      .finally(() => {
        lastExternalSyncAt = Date.now();
        externalSyncInFlight = null;
      });
  }

  await externalSyncInFlight;
}

export async function runTokenTrackerSync() {
  const require = createPackageRequire();
  const { cmdSync } = require('tokentracker-cli/src/commands/sync');
  await cmdSync(['--auto']);
}

export async function syncTokenTrackerUsage(options: SyncOptions = {}) {
  if (options.runExternalSync ?? true) {
    await runTokenTrackerSyncIfNeeded();
  }

  return syncTokenTrackerEvents(options);
}
