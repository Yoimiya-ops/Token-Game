import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { tokenEventSchema, tokenEventToQi, type TokenEvent } from '@token-game/shared';
import { applyStoredEvent, updateLedger, updateLedgerFile, type Ledger } from '../store';
import { getDefaultProviders } from './providers';
import { readTrackerState, writeTrackerState, getProviderState, getInode, resolveCursor } from './state';
import { aggregateEvents, bucketsToRows, type MutableBucket } from './aggregator';
import type { Bucket, FileCursor, ProviderSyncResult, RawEvent, SourceId, TrackerState } from './types';

/**
 * Where the embedded tracker stores its data on disk. We use a token-game-
 * specific directory so we never collide with a separately installed
 * tokentracker-cli install at ~/.tokentracker.
 */
export function resolveTrackerDataDir(home: string = homedir()): string {
  return join(home, '.token-game', 'tracker');
}

export function resolveStatePath(home: string = homedir()): string {
  return join(resolveTrackerDataDir(home), 'state.json');
}

export function resolveEventsPath(home: string = homedir()): string {
  return join(resolveTrackerDataDir(home), 'events.jsonl');
}

// ──────────────────────────────────────────────────────────────────────────
// Bucket ↔ game TokenEvent conversion
// ──────────────────────────────────────────────────────────────────────────

type SyncOptions = {
  events?: TokenEvent[];
  queuePath?: string;
  ledgerPath?: string;
  /** When true, the caller will use the provided events list and skip
   *  re-reading the events file. Used by tests. */
  skipFileLoad?: boolean;
  /** When true (default), the embedded tracker also runs a sync before
   *  applying events. Tests pass false. */
  runExternalSync?: boolean;
};

export type TokenTrackerSyncStatus = {
  lastAttemptedAt: string | null;
  lastSucceededAt: string | null;
  lastError: string | null;
  lastImportedTokens: number;
  queuePath: string;
  queueUpdatedAt: string | null;
};

const TRACKER_NAME = 'Token-Game Embedded Tracker';
const DEFAULT_SYNC_INTERVAL_MS = 30_000;
let lastSyncAt = 0;
let syncInFlight: Promise<TokenTrackerSyncStatus> | null = null;
const syncState: Omit<TokenTrackerSyncStatus, 'queuePath' | 'queueUpdatedAt'> = {
  lastAttemptedAt: null,
  lastSucceededAt: null,
  lastError: null,
  lastImportedTokens: 0
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function safeIdPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9.-]/g, '-');
}

function bucketKey(row: Bucket, kind: TokenEvent['kind']): string {
  return `${row.source}|${row.model}|${row.hour_start}|${kind}`;
}

function eventId(row: Bucket, kind: TokenEvent['kind'], tokenCount: number): string {
  return [
    'tokentracker',
    safeIdPart(row.source),
    safeIdPart(row.model),
    safeIdPart(row.hour_start),
    kind,
    tokenCount
  ].join(':');
}

function positiveInteger(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function normalizeBucket(row: Bucket): Bucket {
  const input = positiveInteger(row.input_tokens);
  const cached = positiveInteger(row.cached_input_tokens);
  const output = positiveInteger(row.output_tokens);
  const total = positiveInteger(row.total_tokens);

  // Codex's last_token_usage reports input_tokens as the full prompt (incl.
  // cached prefix), while its event message and our game expect a separation.
  // Mirror the original token-tracker.ts normalization so the math stays
  // consistent regardless of where the bucket was sourced.
  if (
    (row.source === 'codex') &&
    cached > 0 &&
    input >= cached &&
    total === input + output
  ) {
    return { ...row, input_tokens: input - cached };
  }
  return row;
}

function readEventsFile(eventsPath: string): Bucket[] {
  if (!existsSync(eventsPath)) return [];
  const out: Bucket[] = [];
  const lines = readFileSync(eventsPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const bucket = normalizeBucket(JSON.parse(line) as Bucket);
      if (bucket.hour_start) {
        out.push(bucket);
      }
    } catch {
      // Skip corrupt lines — the file is append-only and may have a torn
      // tail from a previous crash.
    }
  }
  return out;
}

function bucketsToEvents(buckets: Bucket[]): TokenEvent[] {
  const events: TokenEvent[] = [];
  for (const row of buckets) {
    const parts: Array<{ kind: TokenEvent['kind']; tokenCount: number }> = [
      { kind: 'input', tokenCount: positiveInteger(row.input_tokens) },
      { kind: 'cached', tokenCount: positiveInteger(row.cached_input_tokens) },
      { kind: 'output', tokenCount: positiveInteger(row.output_tokens) },
      { kind: 'reasoning', tokenCount: positiveInteger(row.reasoning_output_tokens) }
    ];
    for (const part of parts) {
      if (part.tokenCount <= 0) continue;
      events.push(
        tokenEventSchema.parse({
          id: eventId(row, part.kind, part.tokenCount),
          source: 'tokentracker',
          model: row.model ?? 'unknown',
          kind: part.kind,
          tokenCount: part.tokenCount,
          occurredAt: row.hour_start,
          metadata: {
            tracker: TRACKER_NAME,
            trackerSource: row.source,
            bucketKey: bucketKey(row, part.kind)
          }
        })
      );
    }
  }
  return events;
}

// ──────────────────────────────────────────────────────────────────────────
// File-backed event store (events.jsonl)
// ──────────────────────────────────────────────────────────────────────────

function readAllBuckets(eventsPath: string): Map<string, MutableBucket> {
  const buckets = new Map<string, MutableBucket>();
  if (!existsSync(eventsPath)) return buckets;
  const lines = readFileSync(eventsPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const row = normalizeBucket(JSON.parse(line) as Bucket);
      if (!row.hour_start) continue;
      const key = `${row.source}|${row.model}|${row.hour_start}`;
      buckets.set(key, {
        source: row.source,
        model: row.model,
        hour_start: row.hour_start,
        input_tokens: positiveInteger(row.input_tokens),
        cached_input_tokens: positiveInteger(row.cached_input_tokens),
        output_tokens: positiveInteger(row.output_tokens),
        reasoning_output_tokens: positiveInteger(row.reasoning_output_tokens),
        total_tokens: positiveInteger(row.total_tokens)
      });
    } catch {
      // ignore
    }
  }
  return buckets;
}

function writeAllBuckets(eventsPath: string, buckets: Iterable<MutableBucket>): void {
  const dir = dirname(eventsPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const rows = bucketsToRows(buckets);
  writeFileSync(eventsPath, rows.map((b) => JSON.stringify(b)).join('\n') + (rows.length ? '\n' : ''));
}

// ──────────────────────────────────────────────────────────────────────────
// Sync engine
// ──────────────────────────────────────────────────────────────────────────

async function runSyncOnce(): Promise<TokenTrackerSyncStatus> {
  syncState.lastAttemptedAt = new Date().toISOString();
  const statePath = resolveStatePath();
  const eventsPath = resolveEventsPath();
  const state = readTrackerState(statePath);
  const buckets = readAllBuckets(eventsPath);
  const providers = getDefaultProviders();
  const syncStartedAt = new Date().toISOString();

  // First-sync bootstrap: stamp firstSyncAt once. Aggregator filters out
  // events before this so install-time historical usage is not credited.
  if (!state.firstSyncAt) {
    state.firstSyncAt = syncStartedAt;
  }

  const providerResults: ProviderSyncResult[] = [];
  let anyError = false;

  for (const provider of providers) {
    const providerState = getProviderState(state, provider.id);
    const files = await provider.listFiles();
    let filesScanned = 0;
    let eventsEmitted = 0;
    const freshEvents: RawEvent[] = [];

    for (const filePath of files) {
      const currentInode = getInode(filePath);
      const prev = providerState.files[filePath] ?? null;
      const effectivePrev = resolveCursor(prev, currentInode);
      try {
        const { events, newCursor } = await provider.parseFile(filePath, effectivePrev);
        if (newCursor) {
          providerState.files[filePath] = newCursor;
        }
        freshEvents.push(...events);
        filesScanned += 1;
        eventsEmitted += events.length;
      } catch (error) {
        anyError = true;
        providerResults.push({
          provider: provider.id,
          filesScanned,
          eventsEmitted,
          bucketsUpdated: 0,
          error: errorMessage(error)
        });
        // Stop processing this provider on the first error, but keep going
        // for other providers.
        break;
      }
    }

    // firstSyncAt filter is the single point where pre-install usage is
    // discarded. See aggregator.ts for the per-event filter.
    const aggregated = aggregateEvents(freshEvents, { firstSyncAt: state.firstSyncAt });
    let bucketsUpdated = 0;
    for (const [key, fresh] of aggregated) {
      const existing = buckets.get(key);
      if (!existing) {
        buckets.set(key, fresh);
        bucketsUpdated += 1;
        continue;
      }
      // Replace fields rather than sum — the provider already sums within
      // its own hour bucket. Re-running sync on the same file with the same
      // cursor should produce the same buckets.
      const changed =
        existing.input_tokens !== fresh.input_tokens ||
        existing.cached_input_tokens !== fresh.cached_input_tokens ||
        existing.output_tokens !== fresh.output_tokens ||
        existing.reasoning_output_tokens !== fresh.reasoning_output_tokens;
      existing.input_tokens = fresh.input_tokens;
      existing.cached_input_tokens = fresh.cached_input_tokens;
      existing.output_tokens = fresh.output_tokens;
      existing.reasoning_output_tokens = fresh.reasoning_output_tokens;
      existing.total_tokens = fresh.total_tokens;
      if (changed) {
        bucketsUpdated += 1;
      }
    }

    if (!providerResults.find((r) => r.provider === provider.id && r.error)) {
      providerResults.push({ provider: provider.id, filesScanned, eventsEmitted, bucketsUpdated });
    }
  }

  writeAllBuckets(eventsPath, buckets.values());
  writeTrackerState(statePath, state);

  if (!anyError) {
    syncState.lastSucceededAt = new Date().toISOString();
    syncState.lastError = null;
  }

  return {
    ...syncState,
    queuePath: eventsPath,
    queueUpdatedAt: statSyncSafe(eventsPath)
  };
}

function statSyncSafe(filePath: string): string | null {
  try {
    return statSync(filePath).mtime.toISOString();
  } catch {
    return null;
  }
}

export async function runTokenTrackerSync(): Promise<TokenTrackerSyncStatus> {
  if (!syncInFlight) {
    syncInFlight = runSyncOnce()
      .catch((error) => {
        syncState.lastError = errorMessage(error);
        return {
          ...syncState,
          queuePath: resolveEventsPath(),
          queueUpdatedAt: null
        };
      })
      .finally(() => {
        lastSyncAt = Date.now();
        syncInFlight = null;
      });
  }
  return syncInFlight;
}

export async function runTokenTrackerSyncIfNeeded(now = Date.now()): Promise<void> {
  if (now - lastSyncAt < DEFAULT_SYNC_INTERVAL_MS) return;
  await runTokenTrackerSync();
}

// ──────────────────────────────────────────────────────────────────────────
// Public API (compatible with the previous token-tracker.ts surface)
// ──────────────────────────────────────────────────────────────────────────

/**
 * Backward-compatible: previously this pointed at the tokentracker-cli queue
 * file at ~/.tokentracker/tracker/queue.jsonl. Now it points at our own
 * events.jsonl. Existing call sites can keep using the same function name.
 */
export function resolveTokenTrackerQueuePath(home: string = homedir()): string {
  return resolveEventsPath(home);
}

export function getTokenTrackerSyncStatus(queuePath: string = resolveEventsPath()): TokenTrackerSyncStatus {
  return {
    ...syncState,
    queuePath,
    queueUpdatedAt: statSyncSafe(queuePath)
  };
}

export function loadTokenTrackerEventsFromQueue(queuePath: string = resolveEventsPath()): TokenEvent[] {
  return bucketsToEvents(readEventsFile(queuePath));
}

function qiGainedFor(deltaEvent: TokenEvent, realmLevel: number): number {
  return tokenEventToQi(deltaEvent.tokenCount) + realmLevel * 2;
}

function applyTrackerEvents(ledger: Ledger, events: TokenEvent[]): number {
  let imported = 0;
  const bucketTokens = ledger.trackerState.bucketTokens;

  for (const event of events) {
    const key =
      typeof event.metadata?.bucketKey === 'string'
        ? event.metadata.bucketKey
        : `${event.source}|${event.model}|${event.occurredAt}|${event.kind}`;
    const previousTokenCount = positiveInteger(bucketTokens[key]);
    if (event.tokenCount <= previousTokenCount) continue;

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

export function syncTokenTrackerEvents(options: SyncOptions = {}): number {
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

export async function syncTokenTrackerUsage(options: SyncOptions = {}): Promise<number> {
  if (options.runExternalSync ?? true) {
    await runTokenTrackerSyncIfNeeded();
  }
  const imported = syncTokenTrackerEvents(options);
  syncState.lastImportedTokens = imported;
  return imported;
}

/**
 * For tests: blow away the embedded tracker's on-disk state so each test
 * gets a clean slate. Resets only the paths it owns; ledger state is not
 * touched (use purgeMockEvents for that).
 */
export function resetTrackerDataForTest(home: string = homedir()): void {
  const statePath = resolveStatePath(home);
  const eventsPath = resolveEventsPath(home);
  for (const p of [statePath, eventsPath]) {
    try {
      unlinkSync(p);
    } catch {
      // missing
    }
  }
  lastSyncAt = 0;
  syncState.lastAttemptedAt = null;
  syncState.lastSucceededAt = null;
  syncState.lastError = null;
  syncState.lastImportedTokens = 0;
}

// Re-export types so callers don't need to reach into ./types directly.
export type { Bucket, FileCursor, RawEvent, SourceId, TrackerState };
