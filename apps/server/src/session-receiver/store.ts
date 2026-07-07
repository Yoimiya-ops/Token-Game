/**
 * Server-side store for session-based token collection.
 *
 * Persists a single JSON document under the server data dir (default
 * `<repo>/apps/server/data/sessions.json`). The document maps
 * `deviceKey -> DeviceRecord`, and every device holds at most one
 * `openSession`. Closed sessions are kept in `closedSessions` for the
 * audit trail.
 *
 * Why file-backed and not in-memory: the server is the source of truth
 * for "is this player currently in an active session, and how far has
 * it ticked". A process restart must NOT forget the open session —
 * otherwise a closed desktop app would leak tokens until next launch.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  SESSION_STORE_VERSION,
  SESSION_FILE_NAME,
  type DeviceKey,
  type DeviceRecord,
  type FileCursor,
  type FileSnapshot,
  type ManualRefreshDecision,
  type ManualRefreshAudit,
  type SessionBucketDelta,
  type SessionId,
  type SessionRecord,
  type SessionStoreFile
} from './types';

const STORE_VERSION = SESSION_STORE_VERSION;

/**
 * Default data directory. Honours `TOKEN_GAME_DATA_DIR` (used by the
 * desktop electron launcher to redirect to userData); otherwise walks
 * `cwd` to find `apps/server/data`.
 */
function defaultDataDir(): string {
  const configured = process.env.TOKEN_GAME_DATA_DIR;
  const cwd = process.cwd();
  if (configured) return resolve(configured);
  return cwd.includes(`${['apps', 'server'].join('server')}`)
    ? resolve(cwd, 'data')
    : resolve(cwd, 'apps', 'server', 'data');
}

export function resolveSessionStorePath(): string {
  return resolve(defaultDataDir(), SESSION_FILE_NAME);
}

function emptyStore(): SessionStoreFile {
  return {
    version: STORE_VERSION,
    updatedAt: new Date(0).toISOString(),
    devices: {}
  };
}

/**
 * Read the store. Returns an empty store when the file is missing or
 * corrupt — a corrupt store is bad but recoverable (worst case every
 * running player's session is reset), and we'd rather lose history
 * than refuse to start.
 */
export function readSessionStore(path: string = resolveSessionStorePath()): SessionStoreFile {
  if (!existsSync(path)) return emptyStore();
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<SessionStoreFile>;
    if (!raw || typeof raw !== 'object') return emptyStore();
    const devices: Record<string, DeviceRecord> = {};
    if (raw.devices && typeof raw.devices === 'object') {
      for (const [key, value] of Object.entries(raw.devices)) {
        if (!value || typeof value !== 'object') continue;
        const v = value as Partial<DeviceRecord>;
        if (typeof v.deviceKey !== 'string') continue;
        devices[key] = {
          deviceKey: v.deviceKey,
          firstSeenAt: typeof v.firstSeenAt === 'string' ? v.firstSeenAt : new Date().toISOString(),
          lastSeenAt: typeof v.lastSeenAt === 'string' ? v.lastSeenAt : new Date().toISOString(),
          openSession: v.openSession && typeof v.openSession === 'object'
            ? normaliseSession(v.openSession as Partial<SessionRecord>)
            : null,
          closedSessions: Array.isArray(v.closedSessions)
            ? (v.closedSessions as Array<Partial<SessionRecord>>).map((s) => normaliseSession(s))
            : [],
          totalQiGained:
            typeof v.totalQiGained === 'number' ? Math.floor(v.totalQiGained) : 0,
          totalTokensAccepted:
            typeof v.totalTokensAccepted === 'number'
              ? Math.floor(v.totalTokensAccepted)
              : 0
        };
      }
    }
    return {
      version: STORE_VERSION,
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
      devices
    };
  } catch {
    return emptyStore();
  }
}

function normaliseSession(s: Partial<SessionRecord>): SessionRecord {
  return {
    sessionId: typeof s.sessionId === 'string' ? s.sessionId : '',
    startedAt: typeof s.startedAt === 'string' ? s.startedAt : new Date().toISOString(),
    endedAt: typeof s.endedAt === 'string' ? s.endedAt : null,
    clientLabel: typeof s.clientLabel === 'string' ? s.clientLabel : null,
    baselineCursors: Array.isArray(s.baselineCursors)
      ? s.baselineCursors.map(normaliseFileSnapshot)
      : [],
    appliedCursors: Array.isArray(s.appliedCursors)
      ? s.appliedCursors.map(normaliseFileCursor)
      : [],
    totalDeltas:
      typeof s.totalDeltas === 'number' ? Math.max(0, Math.floor(s.totalDeltas)) : 0,
    totalQiGained:
      typeof s.totalQiGained === 'number' ? Math.max(0, Math.floor(s.totalQiGained)) : 0,
    manualRefreshes: Array.isArray(s.manualRefreshes)
      ? (s.manualRefreshes as Array<Partial<ManualRefreshAudit>>).map((m): ManualRefreshAudit => ({
          at: typeof m.at === 'string' ? m.at : new Date().toISOString(),
          deltasEmitted:
            typeof m.deltasEmitted === 'number'
              ? Math.max(0, Math.floor(m.deltasEmitted))
              : 0,
          tickDurationMs:
            typeof m.tickDurationMs === 'number'
              ? Math.max(0, Math.floor(m.tickDurationMs))
              : 0
        }))
      : [],
    lastManualRefreshAt:
      typeof s.lastManualRefreshAt === 'string' ? s.lastManualRefreshAt : null
  };
}

function normaliseFileSnapshot(s: Partial<FileSnapshot>): FileSnapshot {
  return {
    providerId: typeof s.providerId === 'string' ? s.providerId : '',
    path: typeof s.path === 'string' ? s.path : '',
    size: typeof s.size === 'number' ? Math.max(0, Math.floor(s.size)) : 0,
    inode: typeof s.inode === 'number' ? Math.floor(s.inode) : null
  };
}

function normaliseFileCursor(c: Partial<FileCursor>): FileCursor {
  return normaliseFileSnapshot(c);
}

export function writeSessionStore(
  store: SessionStoreFile,
  path: string = resolveSessionStorePath()
): void {
  const parent = dirname(path);
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
  store.updatedAt = new Date().toISOString();
  store.version = STORE_VERSION;
  writeFileSync(path, JSON.stringify(store, null, 2));
}

export function getDevice(
  store: SessionStoreFile,
  deviceKey: DeviceKey | string
): DeviceRecord | null {
  return store.devices[deviceKey] ?? null;
}

/** Look up the open session for the device. */
export function getOpenSession(store: SessionStoreFile, deviceKey: string): SessionRecord | null {
  const device = store.devices[deviceKey];
  return device?.openSession ?? null;
}

/**
 * Look up a session record on a device by id. Returns the open session
 * when ids match, or a closed session from history.
 */
export function getSessionById(
  store: SessionStoreFile,
  deviceKey: string,
  sessionId: string
): SessionRecord | null {
  const device = store.devices[deviceKey];
  if (!device) return null;
  if (device.openSession?.sessionId === sessionId) return device.openSession;
  return device.closedSessions.find((s) => s.sessionId === sessionId) ?? null;
}

/**
 * Open a new session for a device. Rules:
 *   - The device must already exist (callers mint deviceKey + registerDevice first).
 *   - If a session is already open, the open request is rejected.
 *   - Otherwise a new SessionRecord is created with the given baseline.
 */
export type OpenSessionResult =
  | { ok: true; session: SessionRecord }
  | { ok: false; reason: 'session_already_open'; existing: SessionRecord };

export function openSession(
  store: SessionStoreFile,
  args: {
    deviceKey: string;
    sessionId: SessionId | string;
    baselineCursors: FileSnapshot[];
    clientLabel: string | null;
    openedAt: string;
  }
): OpenSessionResult {
  const device = store.devices[args.deviceKey];
  if (!device) {
    return { ok: false, reason: 'session_already_open', existing: null as never };
  }
  if (device.openSession) {
    return { ok: false, reason: 'session_already_open', existing: device.openSession };
  }
  const session: SessionRecord = {
    sessionId: args.sessionId,
    startedAt: args.openedAt,
    endedAt: null,
    clientLabel: args.clientLabel,
    baselineCursors: [...args.baselineCursors],
    appliedCursors: args.baselineCursors.map((s) => ({
      providerId: s.providerId,
      path: s.path,
      size: s.size,
      inode: s.inode
    })),
    totalDeltas: 0,
    totalQiGained: 0,
    manualRefreshes: [],
    lastManualRefreshAt: null
  };
  device.openSession = session;
  device.lastSeenAt = args.openedAt;
  return { ok: true, session };
}

/**
 * Register a brand-new device. Mints the deviceKey first; this does not
 * check for collisions (caller's responsibility). Idempotent: re-calling
 * with the same deviceKey returns the existing record.
 */
export function registerDevice(
  store: SessionStoreFile,
  args: { deviceKey: string; firstSeenAt: string }
): DeviceRecord {
  const existing = store.devices[args.deviceKey];
  if (existing) return existing;
  const created: DeviceRecord = {
    deviceKey: args.deviceKey,
    firstSeenAt: args.firstSeenAt,
    lastSeenAt: args.firstSeenAt,
    openSession: null,
    closedSessions: [],
    totalQiGained: 0,
    totalTokensAccepted: 0
  };
  store.devices[args.deviceKey] = created;
  return created;
}

/** Cursor-monotonicity check. Returns null on success, or a string
 *  explaining why the cursor is invalid (used for the HTTP error code). */
export function verifyCursorMonotonicity(
  session: SessionRecord,
  cursorAfter: FileCursor[]
): null | 'cursor_missing' | 'cursor_regressed' | 'inode_changed' {
  // If the session previously accepted any watched files, the client
  // must continue to report cursors for them on every tick. A tick
  // that drops the watched-files list silently is a regression attempt.
  if (session.appliedCursors.length > 0 && cursorAfter.length === 0) {
    return 'cursor_missing';
  }
  const byPath = new Map<string, FileCursor>();
  for (const c of session.appliedCursors) {
    byPath.set(`${c.providerId}::${c.path}`, c);
  }
  for (const next of cursorAfter) {
    const key = `${next.providerId}::${next.path}`;
    const prev = byPath.get(key);
    if (!prev) return 'cursor_missing';
    if (prev.inode !== null && next.inode !== null && prev.inode !== next.inode) {
      return 'inode_changed';
    }
    if (next.size < prev.size) return 'cursor_regressed';
  }
  return null;
}

/** Apply a tick. Caller is responsible for having verified the signature
 *  and cursor first. Returns the updated session record. */
export type ApplyTickInput = {
  deviceKey: string;
  sessionId: string;
  cursorAfter: FileCursor[];
  deltas: SessionBucketDelta[];
  qiGained: number;
  tokensGained: number;
  triggersBySource: Record<string, number>;
  audit: ManualRefreshAudit | null;
  appliedAt: string;
};

export type ApplyTickOutcome =
  | { ok: true; session: SessionRecord; device: DeviceRecord }
  | { ok: false; reason: 'session_not_found' | 'session_closed' };

export function applyTick(
  store: SessionStoreFile,
  input: ApplyTickInput
): ApplyTickOutcome {
  const device = store.devices[input.deviceKey];
  if (!device) return { ok: false, reason: 'session_not_found' };
  if (!device.openSession || device.openSession.sessionId !== input.sessionId) {
    return { ok: false, reason: 'session_closed' };
  }
  const session = device.openSession;
  session.appliedCursors = input.cursorAfter.map((c) => ({
    providerId: c.providerId,
    path: c.path,
    size: c.size,
    inode: c.inode
  }));
  session.totalDeltas += input.deltas.length;
  session.totalQiGained += Math.max(0, Math.floor(input.qiGained));
  session.lastManualRefreshAt =
    input.audit !== null ? input.audit.at : session.lastManualRefreshAt;
  if (input.audit) {
    session.manualRefreshes.push(input.audit);
  }
  device.lastSeenAt = input.appliedAt;
  device.totalQiGained += Math.max(0, Math.floor(input.qiGained));
  device.totalTokensAccepted += Math.max(0, Math.floor(input.tokensGained));
  return { ok: true, session, device };
}

/** Manual-refresh rate limit (per session).
 *  Returns whether the next manual refresh is allowed now. */
export function evaluateManualRefresh(
  now: Date,
  lastManualAt: string | null,
  minIntervalMs: number
): ManualRefreshDecision {
  if (!lastManualAt) {
    return { allowed: true, nextManualRefreshAllowedAt: now.toISOString() };
  }
  const last = Date.parse(lastManualAt);
  if (Number.isNaN(last)) {
    return { allowed: true, nextManualRefreshAllowedAt: now.toISOString() };
  }
  const elapsed = now.getTime() - last;
  if (elapsed >= minIntervalMs) {
    return { allowed: true, nextManualRefreshAllowedAt: now.toISOString() };
  }
  const retryMs = minIntervalMs - elapsed;
  const allowedAt = new Date(last + minIntervalMs);
  return {
    allowed: false,
    reason: 'rate_limited',
    retryAfterMs: retryMs,
    nextManualRefreshAllowedAt: allowedAt.toISOString()
  };
}

/** Close an open session. Returns outcome. */
export type CloseSessionOutcome =
  | { ok: true; session: SessionRecord; device: DeviceRecord }
  | { ok: false; reason: 'session_not_found' | 'session_closed' };

export function closeSession(
  store: SessionStoreFile,
  args: { deviceKey: string; sessionId: string; closedAt: string }
): CloseSessionOutcome {
  const device = store.devices[args.deviceKey];
  if (!device) return { ok: false, reason: 'session_not_found' };
  if (!device.openSession || device.openSession.sessionId !== args.sessionId) {
    return { ok: false, reason: 'session_closed' };
  }
  const session = device.openSession;
  session.endedAt = args.closedAt;
  device.closedSessions.push(session);
  device.openSession = null;
  device.lastSeenAt = args.closedAt;
  return { ok: true, session, device };
}

/** Server-side sweep: close any session that hasn't been ticked in
 *  `maxIdleMs`. Returns how many were swept. */
export function sweepIdleSessions(
  store: SessionStoreFile,
  args: { now: Date; maxIdleMs: number }
): number {
  let swept = 0;
  for (const device of Object.values(store.devices)) {
    if (!device.openSession) continue;
    const lastSeen = Date.parse(device.lastSeenAt);
    if (Number.isNaN(lastSeen)) continue;
    if (args.now.getTime() - lastSeen > args.maxIdleMs) {
      device.openSession.endedAt = device.lastSeenAt;
      device.closedSessions.push(device.openSession);
      device.openSession = null;
      swept += 1;
    }
  }
  return swept;
}

/** Test helper. Wipes a single store file to its empty contents. */
export function resetSessionStoreForTest(path?: string): void {
  if (!path) return;
  if (existsSync(path)) {
    writeFileSync(path, JSON.stringify(emptyStore()));
  }
}
