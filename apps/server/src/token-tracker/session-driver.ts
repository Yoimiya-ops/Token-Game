/**
 * Session driver: orchestrates the GameSession lifecycle on the server.
 *
 * Responsibilities:
 *   - On `openSession`, capture a per-session cursor baseline across
 *     every provider and start a 60s ticker.
 *   - On each ticker, call `runSessionTick` to read new events, then
 *     `applyTick` straight into the session-receiver store. The
 *     ticker is per-session, so closing a session stops its loop.
 *   - On `manualRefresh`, run the same tick logic with `trigger='manual'`
 *     and respect the 5-second rate limit (`evaluateManualRefresh`).
 *
 * This module does NOT serve HTTP. The HTTP routes in
 * `apps/server/src/session-receiver/routes.ts` call into here for the
 * driver-side actions; the legacy client-driven tick/refresh routes
 * still work (they just don't drive a ticker).
 */

import { randomUUID } from 'node:crypto';
import { appendEvent, readLedger } from '../store';
import { tokenEventToQi } from '@token-game/shared';
import {
  applyTick,
  evaluateManualRefresh,
  getDevice,
  getOpenSession,
  MIN_MANUAL_REFRESH_INTERVAL_MS,
  openSession as openSessionRecord,
  readSessionStore,
  registerDevice,
  SESSION_MAX_IDLE_MS,
  writeSessionStore
} from '../session-receiver/index';
import type {
  DeviceRecord,
  FileSnapshot,
  OpenSessionResponse,
  SessionBucketDelta,
  SessionRecord,
  SessionStoreFile
} from '../session-receiver/types';
import {
  openSessionBaseline,
  runSessionTick,
  type SessionBaseline,
  type SessionFileState
} from './session-sync';
import type { Provider } from './providers';

const DEFAULT_TICK_INTERVAL_MS = 60_000;

export type SessionDriverOptions = {
  /** Override the providers (used by tests). */
  providers?: Provider[];
  /** Override the tick interval in ms (used by tests). */
  tickIntervalMs?: number;
};

export type StartSessionArgs = {
  deviceKey: string;
  /** Optional pre-computed baseline (e.g. when the client supplied
   *  its own cursors). When omitted, the driver stats every file. */
  baselineCursors?: FileSnapshot[];
  clientLabel?: string | null;
};

export type ManualRefreshOutcome =
  | {
      ok: true;
      deltasEmitted: number;
      eventsEmitted: number;
      tickDurationMs: number;
      /** Total qi gained by this manual tick (sum of all delta qi). */
      qiGained: number;
      /** Per-source token totals. */
      triggersAppliedBySource: Record<string, number>;
    }
  | { ok: false; reason: 'rate_limited' | 'no_session' | 'session_closed' | 'mismatch'; retryAfterMs?: number; nextManualRefreshAllowedAt?: string };

type RunOneTickOutcome =
  | {
      ok: true;
      deltas: SessionBucketDelta[];
      eventsEmitted: number;
      tickDurationMs: number;
      qiGained: number;
      tokensGained: number;
      triggersAppliedBySource: Record<string, number>;
    }
  | { ok: false; reason: 'no_session' | 'mismatch' | 'session_closed' };

/** The live in-memory state for a single GameSession. */
type LiveSession = {
  record: SessionRecord;
  deviceKey: string;
  states: Map<string, Map<string, SessionFileState>>;
  timer: NodeJS.Timeout;
  lastTickAt: string | null;
};

export class SessionDriver {
  private providers: Provider[];
  private readonly tickIntervalMs: number;
  private readonly storePath: string;
  private readonly live = new Map<string, LiveSession>();
  private readonly tickLocks = new Map<string, Promise<void>>();

  constructor(storePath: string, options: SessionDriverOptions = {}) {
    this.storePath = storePath;
    this.providers = options.providers ?? [];
    this.tickIntervalMs = options.tickIntervalMs ?? DEFAULT_TICK_INTERVAL_MS;
  }

  /** For tests / dynamic provider registration. */
  setProviders(providers: Provider[]) {
    this.providers = providers;
  }

  /** Start a session for the given device. Mints a new sessionId if the
   *  device doesn't have one open. The returned response shape matches
   *  `OpenSessionResponse` from the HTTP routes. */
  async startSession(args: StartSessionArgs): Promise<
    { ok: true; response: OpenSessionResponse; session: SessionRecord } | { ok: false; reason: 'session_already_open'; existing: SessionRecord }
  > {
    const store = readSessionStore(this.storePath);
    const openedAt = new Date().toISOString();
    registerDevice(store, { deviceKey: args.deviceKey, firstSeenAt: openedAt });

    const existing = getOpenSession(store, args.deviceKey);
    if (existing) {
      return { ok: false, reason: 'session_already_open', existing };
    }

    const sessionId = randomUUID();
    let baseline: SessionBaseline;
    try {
      baseline = await openSessionBaseline(this.providers);
    } catch (err) {
      return {
        ok: false,
        reason: 'session_already_open', // not quite, but caller maps to 5xx
        existing: null as unknown as SessionRecord
      };
    }

    // Caller-supplied cursors (e.g. for resume) override the file stat
    // baseline we just built, but only on a per-path basis.
    const baselineCursors = mergeBaselines(baseline.cursors, args.baselineCursors);

    const opened = openSessionRecord(store, {
      deviceKey: args.deviceKey,
      sessionId,
      baselineCursors,
      clientLabel: args.clientLabel ?? null,
      openedAt
    });
    if (!opened.ok) {
      return opened;
    }
    writeSessionStore(store, this.storePath);
    const timer = this.scheduleTicks(args.deviceKey, opened.session.sessionId);
    const live: LiveSession = {
      record: opened.session,
      deviceKey: args.deviceKey,
      states: baseline.states,
      timer,
      lastTickAt: null
    };
    this.live.set(opened.session.sessionId, live);
    return {
      ok: true,
      session: opened.session,
      response: {
        deviceKey: args.deviceKey,
        sessionId,
        manualRefreshMinIntervalMs: MIN_MANUAL_REFRESH_INTERVAL_MS,
        sessionMaxIdleMs: SESSION_MAX_IDLE_MS
      }
    };
  }

  /** Manual refresh: trigger a tick on the named session right now. */
  async manualRefresh(args: {
    deviceKey: string;
    sessionId: string;
  }): Promise<ManualRefreshOutcome> {
    const live = this.live.get(args.sessionId);
    if (!live) {
      return { ok: false, reason: 'no_session' };
    }
    if (live.deviceKey !== args.deviceKey) {
      return { ok: false, reason: 'mismatch' };
    }
    if (live.record.endedAt !== null) {
      return { ok: false, reason: 'session_closed' };
    }

    return this.withSessionTickLock(args.sessionId, async () => {
      const currentLive = this.live.get(args.sessionId);
      if (!currentLive) {
        return { ok: false, reason: 'no_session' };
      }
      if (currentLive.deviceKey !== args.deviceKey) {
        return { ok: false, reason: 'mismatch' };
      }
      if (currentLive.record.endedAt !== null) {
        return { ok: false, reason: 'session_closed' };
      }

      // The store is the source of truth for lastManualRefreshAt —
      // live.record is just a snapshot and gets stale on every tick.
      // Check it while holding the per-session lock, otherwise two
      // concurrent manual refreshes can both pass the 5s gate before
      // the first one writes its audit record.
      const store = readSessionStore(this.storePath);
      const device = store.devices[args.deviceKey];
      const lastManualAt = device?.openSession?.lastManualRefreshAt ?? null;
      const decision = evaluateManualRefresh(
        new Date(),
        lastManualAt,
        MIN_MANUAL_REFRESH_INTERVAL_MS
      );
      if (!decision.allowed) {
        return {
          ok: false,
          reason: 'rate_limited',
          retryAfterMs: decision.retryAfterMs,
          nextManualRefreshAllowedAt: decision.nextManualRefreshAllowedAt
        };
      }
      const result = await this.runOneTickUnlocked(args.sessionId, { isManual: true });
      if (!result.ok) {
        return { ok: false, reason: result.reason };
      }
      return {
        ok: true,
        deltasEmitted: result.deltas.length,
        eventsEmitted: result.eventsEmitted,
        tickDurationMs: result.tickDurationMs,
        qiGained: result.qiGained,
        triggersAppliedBySource: result.triggersAppliedBySource
      };
    });
  }

  /** Like manualRefresh, but the caller only knows the deviceKey.
   *  Used by the desktop / web "立刻入账" button — they don't have
   *  cursor state so they can't construct a signed TickRequest. The
   *  server resolves the open sessionId for them. */
  async manualRefreshByDeviceKey(args: { deviceKey: string }): Promise<ManualRefreshOutcome> {
    const store = readSessionStore(this.storePath);
    const device = store.devices[args.deviceKey];
    if (!device?.openSession) {
      return { ok: false, reason: 'no_session' };
    }
    return this.manualRefresh({
      deviceKey: args.deviceKey,
      sessionId: device.openSession.sessionId
    });
  }

  /** Return the most recently active device (used by the web
   *  dashboard to discover the deviceKey without going through the
   *  desktop IPC). */
  activeDeviceKey(): string | null {
    const store = readSessionStore(this.storePath);
    let best: { deviceKey: string; lastSeenAt: number } | null = null;
    for (const device of Object.values(store.devices)) {
      if (!device.openSession) continue;
      const ts = Date.parse(device.lastSeenAt);
      if (Number.isNaN(ts)) continue;
      if (!best || ts > best.lastSeenAt) {
        best = { deviceKey: device.deviceKey, lastSeenAt: ts };
      }
    }
    return best?.deviceKey ?? null;
  }

  /** Stop a session: clear its ticker and move it to closedSessions. */
  async stopSession(args: { deviceKey: string; sessionId: string }): Promise<
    { ok: true; session: SessionRecord } | { ok: false; reason: 'no_session' | 'mismatch' }
  > {
    const live = this.live.get(args.sessionId);
    if (!live) return { ok: false, reason: 'no_session' };
    if (live.deviceKey !== args.deviceKey) return { ok: false, reason: 'mismatch' };
    clearInterval(live.timer);
    this.live.delete(args.sessionId);

    const store = readSessionStore(this.storePath);
    const device = store.devices[args.deviceKey];
    if (!device?.openSession || device.openSession.sessionId !== args.sessionId) {
      return { ok: false, reason: 'no_session' };
    }
    const closedAt = new Date().toISOString();
    device.openSession.endedAt = closedAt;
    device.closedSessions.push(device.openSession);
    device.openSession = null;
    device.lastSeenAt = closedAt;
    writeSessionStore(store, this.storePath);
    return { ok: true, session: live.record };
  }

  /** Stop every running ticker. Used during server shutdown. */
  shutdown() {
    for (const live of this.live.values()) {
      clearInterval(live.timer);
    }
    this.live.clear();
    // Drop the periodic sweep that runs idle-session cleanup — also
    // installed by the session-receiver routes. It must not keep the
    // test process alive.
    this.unrefIdleSweep();
  }

  /** Tracked sweep timer that we'd start lazily if it isn't already. */
  private idleSweepTimer: NodeJS.Timeout | null = null;
  private unrefIdleSweep() {
    if (this.idleSweepTimer) {
      clearInterval(this.idleSweepTimer);
      this.idleSweepTimer = null;
    }
  }

  /** Re-attach to a session that was open before a process restart. The
   *  legacy in-memory state is gone, so we re-stat every file and
   *  start a fresh ticker. Tokens used in the gap are forfeited —
   *  documented in the design spec. */
  async reattach(deviceKey: string): Promise<{ ok: true; session: SessionRecord } | { ok: false; reason: 'no_open_session' }> {
    const store = readSessionStore(this.storePath);
    const device = getDevice(store, deviceKey);
    const openRecord = device?.openSession;
    if (!openRecord) return { ok: false, reason: 'no_open_session' };
    const baseline = await openSessionBaseline(this.providers);
    const timer = this.scheduleTicks(deviceKey, openRecord.sessionId);
    this.live.set(openRecord.sessionId, {
      record: openRecord,
      deviceKey,
      states: baseline.states,
      timer,
      lastTickAt: null
    });
    return { ok: true, session: openRecord };
  }

  /** For tests. */
  _isLive(sessionId: string): boolean {
    return this.live.has(sessionId);
  }

  // ──────────────────────────────────────────────────────────────────
  // Internal: scheduling + tick execution
  // ──────────────────────────────────────────────────────────────────

  private scheduleTicks(deviceKey: string, sessionId: string): NodeJS.Timeout {
    const timer = setInterval(() => {
      void this.runOneTick(sessionId, { isManual: false }).catch(() => {
        // Tick errors are non-fatal: the next interval tries again.
      });
    }, this.tickIntervalMs);
    // unref so a stray interval doesn't keep the process alive after
    // shutdown. Tests rely on this so the runner can exit cleanly.
    if (typeof (timer as { unref?: () => unknown }).unref === 'function') {
      (timer as { unref: () => unknown }).unref();
    }
    return timer;
  }

  private async withSessionTickLock<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tickLocks.get(sessionId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const next = previous.catch(() => undefined).then(() => gate);
    this.tickLocks.set(sessionId, next);

    await previous.catch(() => undefined);
    try {
      return await task();
    } finally {
      release();
      if (this.tickLocks.get(sessionId) === next) {
        this.tickLocks.delete(sessionId);
      }
    }
  }

  private async runOneTick(
    sessionId: string,
    options: { isManual: boolean }
  ): Promise<RunOneTickOutcome> {
    return this.withSessionTickLock(sessionId, () => this.runOneTickUnlocked(sessionId, options));
  }

  private async runOneTickUnlocked(
    sessionId: string,
    options: { isManual: boolean }
  ): Promise<RunOneTickOutcome> {
    const live = this.live.get(sessionId);
    if (!live) return { ok: false, reason: 'no_session' };
    if (live.record.endedAt !== null) return { ok: false, reason: 'session_closed' };

    const tickStart = Date.now();
    const outcome = await runSessionTick({
      providers: this.providers,
      states: live.states
    });
    const tickDurationMs = Date.now() - tickStart;

    // Apply via the session-receiver store. We bypass the HTTP layer
    // (no need to re-sign) — but the same applyTick rules apply.
    const store = readSessionStore(this.storePath);
    const device = store.devices[live.deviceKey];
    if (!device?.openSession || device.openSession.sessionId !== sessionId) {
      return { ok: false, reason: 'session_closed' };
    }
    const ledger = readLedger();
    let qiGained = 0;
    let tokensGained = 0;
    for (const delta of outcome.deltas) {
      const tokenCount =
        delta.inputTokens +
        delta.cachedInputTokens +
        delta.outputTokens +
        delta.reasoningOutputTokens;
      if (tokenCount <= 0) continue;
      const eventQi = tokenEventToQi(tokenCount) + ledger.player.realmLevel * 2;
      appendEvent({
        id: `session:${delta.key}:${tokenCount}:${tickStart}`,
        source: 'tokentracker',
        model: delta.model,
        kind: 'input',
        tokenCount,
        occurredAt: delta.hourStart,
        metadata: {
          bucketKey: delta.key,
          tracker: 'session-driver',
          inputTokens: delta.inputTokens,
          cachedInputTokens: delta.cachedInputTokens,
          outputTokens: delta.outputTokens,
          reasoningOutputTokens: delta.reasoningOutputTokens,
          tickTrigger: options.isManual ? 'manual' : 'scheduled'
        },
        qiGained: eventQi
      });
      qiGained += eventQi;
      tokensGained += tokenCount;
    }

    const audit =
      options.isManual
        ? {
            at: new Date().toISOString(),
            deltasEmitted: outcome.deltas.length,
            tickDurationMs
          }
        : null;

    applyTick(store, {
      deviceKey: live.deviceKey,
      sessionId,
      cursorAfter: outcome.cursorAfter,
      deltas: outcome.deltas,
      qiGained,
      tokensGained,
      triggersBySource: outcome.deltas.reduce<Record<string, number>>((acc, d) => {
        const sum = d.inputTokens + d.cachedInputTokens + d.outputTokens + d.reasoningOutputTokens;
        acc[d.source] = (acc[d.source] ?? 0) + sum;
        return acc;
      }, {}),
      audit,
      appliedAt: new Date().toISOString()
    });
    writeSessionStore(store, this.storePath);
    live.lastTickAt = new Date().toISOString();
    return {
      ok: true,
      deltas: outcome.deltas,
      eventsEmitted: outcome.eventsEmitted,
      tickDurationMs,
      qiGained,
      tokensGained,
      triggersAppliedBySource: outcome.deltas.reduce<Record<string, number>>((acc, d) => {
        const sum = d.inputTokens + d.cachedInputTokens + d.outputTokens + d.reasoningOutputTokens;
        acc[d.source] = (acc[d.source] ?? 0) + sum;
        return acc;
      }, {})
    };
  }
}

function mergeBaselines(stat: FileSnapshot[], override?: FileSnapshot[]): FileSnapshot[] {
  if (!override || override.length === 0) return stat;
  const byPath = new Map<string, FileSnapshot>();
  for (const c of stat) byPath.set(`${c.providerId}::${c.path}`, c);
  for (const c of override) byPath.set(`${c.providerId}::${c.path}`, c);
  return Array.from(byPath.values());
}

/** Helper: when the dev console wants to see what's running. */
export function liveSessionCount(driver: SessionDriver): number {
  return (driver as unknown as { live: Map<string, unknown> }).live.size;
}

export type { SessionStoreFile, DeviceRecord };
