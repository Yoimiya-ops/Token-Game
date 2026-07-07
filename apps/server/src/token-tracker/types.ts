/**
 * Public types for the embedded token tracker.
 *
 * Architecture overview:
 *   - Each Provider knows how to find and parse session files for one AI CLI.
 *   - Raw events (one per API call) are aggregated into Buckets keyed by
 *     (source, model, hour_start). Aggregation is monotonic — same bucket
 *     across re-syncs is replaced, not appended.
 *   - The TrackerState holds per-file cursors (inode + byte offset) so re-sync
 *     only reads new lines.
 */

export type SourceId =
  | 'claude'
  | 'codex'
  | 'kimi-code'
  | 'workbuddy'
  | 'cursor'
  | 'zcode';

export type TokenKind = 'input' | 'cached' | 'output' | 'reasoning';

/**
 * One raw event straight from a session log. Multiple events with the same
 * (source, model, hour_start, kind) get summed into the same bucket.
 */
export type RawEvent = {
  source: SourceId;
  model: string;
  kind: TokenKind;
  tokenCount: number;
  /**
   * ISO-8601 timestamp of the event. The aggregator floors this to the hour
   * boundary so events from the same hour merge correctly.
   */
  occurredAt: string;
};

/**
 * Aggregated bucket — one row per (source, model, hour_start). What we
 * persist to events.jsonl and what the game reads.
 */
export type Bucket = {
  source: SourceId;
  model: string;
  hour_start: string;
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
  total_tokens: number;
};

/**
 * Per-file cursor: where we left off in this file last sync. We store both
 * the inode (to detect file rotation/rewrite) and the byte offset (to skip
 * already-read lines). Some providers (Kimi Code, WorkBuddy) also need a
 * dedup set keyed by message id when their wire format doesn't include a
 * stable per-call key — we cap that set to keep cursor state bounded.
 *
 * `model` is used by Kimi Code to persist the per-session model declared in
 * a `config.update` event so incremental resumes (which start past that
 * line) still know which model to attribute tokens to.
 */
export type FileCursor = {
  inode: number;
  offset: number;
  seenIds?: string[];
  model?: string;
};

export type ProviderState = {
  files: Record<string, FileCursor>;
};

export type TrackerState = {
  version: 1;
  providers: Partial<Record<SourceId, ProviderState>>;
  updatedAt: string | null;
  /**
   * Timestamp recorded the very first time the tracker ran. Aggregator
   * filters out any event whose `occurredAt` is before this so the game
   * never credits token usage the player accumulated before installing it.
   * Set once and never updated.
   */
  firstSyncAt: string | null;
};

export type ProviderSyncResult = {
  provider: SourceId;
  filesScanned: number;
  eventsEmitted: number;
  bucketsUpdated: number;
  error?: string;
};

export type SyncResult = {
  startedAt: string;
  finishedAt: string;
  buckets: Bucket[];
  providers: ProviderSyncResult[];
  hadErrors: boolean;
};

