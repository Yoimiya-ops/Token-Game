import type { Bucket, RawEvent, SourceId, TokenKind } from './types';

/**
 * Floor an ISO timestamp to the start of its UTC hour.
 * The bucket key needs a stable hour boundary or we get drift.
 */
export function floorToHour(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso;
  }
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString();
}

type MutableBucket = {
  source: SourceId;
  model: string;
  hour_start: string;
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
  total_tokens: number;
};

export type { MutableBucket };

function emptyMutableBucket(source: SourceId, model: string, hour_start: string): MutableBucket {
  return {
    source,
    model,
    hour_start,
    input_tokens: 0,
    cached_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: 0
  };
}

const KIND_FIELD: Record<TokenKind, keyof Pick<MutableBucket, 'input_tokens' | 'cached_input_tokens' | 'output_tokens' | 'reasoning_output_tokens'>> = {
  input: 'input_tokens',
  cached: 'cached_input_tokens',
  output: 'output_tokens',
  reasoning: 'reasoning_output_tokens'
};

/**
 * Merge a list of raw events into a fresh bucket map keyed by
 * `${source}|${model}|${hour_start}`. Multiple events for the same bucket
 * are summed.
 *
 * `firstSyncAt` (optional): when provided, events with `occurredAt` strictly
 * before this timestamp are dropped. This is the mechanism that prevents
 * the game from crediting token usage the player accumulated before
 * installing it — by definition only events from after the first sync
 * matter.
 */
export function aggregateEvents(
  rawEvents: RawEvent[],
  options: { firstSyncAt?: string | null } = {}
): Map<string, MutableBucket> {
  const buckets = new Map<string, MutableBucket>();
  const firstSyncAtMs = options.firstSyncAt ? Date.parse(options.firstSyncAt) : NaN;
  const hasFirstSync = !Number.isNaN(firstSyncAtMs);

  for (const event of rawEvents) {
    if (hasFirstSync) {
      const eventMs = Date.parse(event.occurredAt);
      // Drop events that pre-date the player's first sync, OR events whose
      // timestamp is unparseable (better safe than silently crediting a
      // garbage value).
      if (Number.isNaN(eventMs) || eventMs < firstSyncAtMs) continue;
    }
    const hour = floorToHour(event.occurredAt);
    const key = `${event.source}|${event.model}|${hour}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = emptyMutableBucket(event.source, event.model, hour);
      buckets.set(key, bucket);
    }
    const field = KIND_FIELD[event.kind];
    const count = Math.max(0, Math.floor(event.tokenCount));
    bucket[field] += count;
    bucket.total_tokens += count;
  }

  return buckets;
}

/**
 * Merge a fresh batch of buckets into an existing bucket store. Existing
 * buckets are replaced wholesale (not summed) — callers must read the current
 * store first if they need cumulative totals.
 */
export function mergeBuckets(
  existing: Map<string, MutableBucket>,
  fresh: Iterable<MutableBucket>
): Map<string, MutableBucket> {
  const result = new Map(existing);
  for (const bucket of fresh) {
    result.set(`${bucket.source}|${bucket.model}|${bucket.hour_start}`, bucket);
  }
  return result;
}

/**
 * Serialize a bucket map to the JSONL format the game reads. One bucket per
 * line, deterministic key order so diffs stay clean.
 */
export function bucketsToRows(buckets: Map<string, MutableBucket> | Iterable<MutableBucket>): Bucket[] {
  const values: Iterable<MutableBucket> = buckets instanceof Map ? buckets.values() : buckets;
  return Array.from(values, (b) => ({ ...b })).sort((a, b) => {
    if (a.source !== b.source) return a.source.localeCompare(b.source);
    if (a.model !== b.model) return a.model.localeCompare(b.model);
    return a.hour_start.localeCompare(b.hour_start);
  });
}
