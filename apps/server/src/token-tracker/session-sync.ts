/**
 * Session-based token collection: read-side sync helpers.
 *
 * Glue between the existing provider layer (`apps/server/src/token-tracker/
 * providers/*`) and the session-receiver store. We do NOT touch the
 * provider interface or rewrite any of the six providers — instead we
 * drive them through their existing `listFiles` + `parseFile` entry
 * points, convert the byte-offset cursors they expose to the wire
 * format the session-store expects (`{providerId, path, size, inode}`),
 * and aggregate the resulting raw events into the per-hour bucket shape
 * the session-receiver tick consumes.
 *
 * Why a wrapper and not a new provider interface: the user explicitly
 * asked that "all token statistics go through the adapter layer". The
 * adapter layer is exactly these six providers; we feed them, we don't
 * replace them.
 */

import { statSync } from 'node:fs';
import { aggregateEvents, type MutableBucket } from './aggregator';
import type { FileCursor as ProviderCursor, RawEvent, SourceId } from './types';
import type { Provider } from './providers';
import type { FileCursor, SessionBucketDelta } from '../session-receiver/types';

/**
 * Per-session, per-file tracking state. We keep this server-side rather
 * than wire-form so the provider's byte-offset cursor doesn't get
 * serialized through the network.
 */
export type SessionFileState = {
  offset: number;
  inode: number;
};

/** Initial baseline captured when a session opens. */
export type SessionBaseline = {
  cursors: FileCursor[];
  /** providerId → { path → state } */
  states: Map<string, Map<string, SessionFileState>>;
};

/** Read the current size+inode of a file. Returns null on stat failure. */
function statFile(path: string): { size: number; inode: number } | null {
  try {
    const st = statSync(path);
    return { size: st.size, inode: st.ino };
  } catch {
    return null;
  }
}

/** Build a baseline by walking every provider's `listFiles` and stat-ing
 *  each one. Cheap (one stat per file, no reads). */
export async function openSessionBaseline(
  providers: Provider[]
): Promise<SessionBaseline> {
  const cursors: FileCursor[] = [];
  const states = new Map<string, Map<string, SessionFileState>>();
  for (const p of providers) {
    const perProvider = new Map<string, SessionFileState>();
    states.set(p.id, perProvider);
    const files = await p.listFiles();
    for (const filePath of files) {
      const stat = statFile(filePath);
      if (!stat) continue;
      const state: SessionFileState = { offset: stat.size, inode: stat.inode };
      perProvider.set(filePath, state);
      cursors.push({
        providerId: p.id,
        path: filePath,
        size: stat.size,
        inode: stat.inode
      });
    }
  }
  return { cursors, states };
}

export type SessionTickOutcome = {
  /** Aggregated bucket deltas ready for the session-receiver `applyTick`. */
  deltas: SessionBucketDelta[];
  /** Updated wire-format cursors for the same set of files. */
  cursorAfter: FileCursor[];
  /** How many events were read across all providers this tick. */
  eventsEmitted: number;
  /** Files that errored during parseFile; counted but not fatal. */
  errors: Array<{ providerId: SourceId; filePath: string; message: string }>;
};

/**
 * Run one tick: poll every provider, aggregate the events, return bucket
 * deltas + new cursors. Does NOT call into the session-receiver store —
 * the caller is responsible for `applyTick` (so the same data path can
 * be unit-tested without touching disk).
 */
export async function runSessionTick(args: {
  providers: Provider[];
  /** Mutated in place: the per-file offset/inode state. */
  states: Map<string, Map<string, SessionFileState>>;
  /** Optional: events with `occurredAt` strictly before this are dropped. */
  firstSyncAt?: string | null;
}): Promise<SessionTickOutcome> {
  const rawEvents: RawEvent[] = [];
  const cursorAfter: FileCursor[] = [];
  const errors: SessionTickOutcome['errors'] = [];

  for (const p of args.providers) {
    const perProvider = args.states.get(p.id) ?? new Map<string, SessionFileState>();
    args.states.set(p.id, perProvider);
    const files = await p.listFiles();
    for (const filePath of files) {
      const prev = perProvider.get(filePath) ?? { offset: 0, inode: 0 };
      let parseResult: { events: RawEvent[]; newCursor: ProviderCursor | null };
      try {
        parseResult = await p.parseFile(filePath, prev);
      } catch (err) {
        errors.push({ providerId: p.id, filePath, message: errMessage(err) });
        continue;
      }
      const stat = statFile(filePath);
      // Some providers (kimi / workbuddy) carry an inode inside the
      // cursor; if the file was rewritten the parseFile would already
      // have reset its offset. Trust the cursor.
      const newOffset = parseResult.newCursor?.offset ?? prev.offset;
      const newInode = parseResult.newCursor?.inode ?? stat?.inode ?? prev.inode;
      perProvider.set(filePath, { offset: newOffset, inode: newInode });
      cursorAfter.push({
        providerId: p.id,
        path: filePath,
        size: newOffset,
        inode: newInode
      });
      if (parseResult.events.length > 0) rawEvents.push(...parseResult.events);
    }
  }

  const aggregated = aggregateEvents(rawEvents, { firstSyncAt: args.firstSyncAt ?? null });
  const deltas = bucketMapToSessionDeltas(aggregated);

  return {
    deltas,
    cursorAfter,
    eventsEmitted: rawEvents.length,
    errors
  };
}

/** Convert aggregator buckets (with underscored field names) into the
 *  session-receiver's wire shape. */
function bucketMapToSessionDeltas(
  buckets: Map<string, MutableBucket>
): SessionBucketDelta[] {
  const out: SessionBucketDelta[] = [];
  for (const bucket of buckets.values()) {
    out.push({
      key: `${bucket.source}|${bucket.model}|${bucket.hour_start}`,
      source: bucket.source,
      model: bucket.model,
      hourStart: bucket.hour_start,
      inputTokens: bucket.input_tokens,
      cachedInputTokens: bucket.cached_input_tokens,
      outputTokens: bucket.output_tokens,
      reasoningOutputTokens: bucket.reasoning_output_tokens
    });
  }
  return out;
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
