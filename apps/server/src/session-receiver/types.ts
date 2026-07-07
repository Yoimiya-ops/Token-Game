/**
 * Session-based token collection: types.
 *
 * One device = one open session at a time. Sessions tick once a minute
 * (or on demand) while the desktop app is alive; deltas are applied
 * straight to the player ledger.
 */

export type SessionId = string & { readonly __sessionBrand: unique symbol };

export type DeviceKey = string & { readonly __deviceBrand: unique symbol };

/** Per-source snapshot of a single log file at the moment a session opens.
 *  Used by the server to verify cursor monotonicity on every tick. */
export type FileSnapshot = {
  /** Provider id (e.g. 'claude-code', 'codex'). */
  providerId: string;
  /** Absolute path the provider reports. Server treats it as an opaque key. */
  path: string;
  /** File size at snapshot time. Adapter polls report size; a smaller size
   *  means the file was rolled/truncated — server rejects. */
  size: number;
  /** Optional inode for adapters that detect rotation. */
  inode: number | null;
};

/** A cursor describing "where the adapter stopped reading" for one file.
 *  Monotonically increases on the client; server validates it. */
export type FileCursor = {
  providerId: string;
  path: string;
  size: number;
  inode: number | null;
};

/** Minimal token event shape going from client to server. The server
 *  applies these bucket deltas straight to the ledger. */
export type SessionBucketDelta = {
  key: string;
  source: string;
  model: string;
  hourStart: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
};

/** A single tick envelope from client. `signature` is HMAC over the
 *  canonical JSON of the same object minus `signature`. */
export type TickRequest = {
  deviceKey: string;
  sessionId: string;
  trigger: 'scheduled' | 'manual';
  clientTimestamp: string;
  deltas: SessionBucketDelta[];
  /** Cursor AFTER the client applied these deltas; next tick must hand
   *  a cursor with `size >= this.size` for each file. */
  cursorAfter: FileCursor[];
  /** Hex HMAC-SHA256 keyed by the deviceKey. */
  signature: string;
};

/** Body for opening a new session. The very first call DOES NOT carry a
 *  device key — the server mints one and returns it. The desktop then
 *  uses that deviceKey for all subsequent signing. */
export type OpenSessionRequest = {
  /** Optional: full set of file snapshots at session start. If omitted
   *  an empty baseline is recorded; first tick will populate it. */
  baselineCursors?: FileSnapshot[];
  /** Optional: human-readable label (e.g. "MacBook Pro · dev"). */
  clientLabel?: string;
};

export type OpenSessionResponse = {
  deviceKey: string;
  sessionId: string;
  /** Minimum gap between two manual refreshes. */
  manualRefreshMinIntervalMs: number;
  /** Maximum session age before the server sweeps it. */
  sessionMaxIdleMs: number;
};

/** One tick response. */
export type TickResponse = {
  ok: true;
  appliedAt: string;
  qiGained: number;
  totalTokens: number;
  triggersAppliedBySource: Record<string, number>;
  nextManualRefreshAllowedAt: string | null;
  trigger: 'scheduled' | 'manual';
};

export type CloseSessionRequest = {
  deviceKey: string;
  sessionId: string;
  clientTimestamp: string;
  signature: string;
};

export type ManualRefreshAllowed = {
  allowed: true;
  nextManualRefreshAllowedAt: string;
};

export type ManualRefreshBlocked = {
  allowed: false;
  reason: 'rate_limited';
  retryAfterMs: number;
  nextManualRefreshAllowedAt: string;
};

export type ManualRefreshDecision = ManualRefreshAllowed | ManualRefreshBlocked;

/** Persisted server-side view of one device. */
export type DeviceRecord = {
  deviceKey: string;
  firstSeenAt: string;
  lastSeenAt: string;
  openSession: SessionRecord | null;
  closedSessions: SessionRecord[];
  totalQiGained: number;
  totalTokensAccepted: number;
};

/** Persisted server-side view of one session. */
export type SessionRecord = {
  sessionId: string;
  startedAt: string;
  endedAt: string | null;
  clientLabel: string | null;
  /** Initial baseline captured when the session opened. */
  baselineCursors: FileSnapshot[];
  /** Cursor positions after the most recent applied tick. */
  appliedCursors: FileCursor[];
  /** Total deltas accepted across all ticks in this session. */
  totalDeltas: number;
  /** Total qi gained across this session. */
  totalQiGained: number;
  /** Audit trail of manual refreshes. */
  manualRefreshes: ManualRefreshAudit[];
  /** Bookkeeping for manual refresh rate-limit. */
  lastManualRefreshAt: string | null;
};

export type ManualRefreshAudit = {
  at: string;
  deltasEmitted: number;
  tickDurationMs: number;
};

export type SessionStoreFile = {
  version: 1;
  updatedAt: string;
  devices: Record<string, DeviceRecord>;
};

export const SESSION_STORE_VERSION = 1 as const;
export const SESSION_FILE_NAME = 'sessions.json';
export const MIN_MANUAL_REFRESH_INTERVAL_MS = 5_000;
export const SESSION_MAX_IDLE_MS = 30 * 60_000; // 30 min
export const MIN_DEVICE_KEY_LENGTH = 32;
