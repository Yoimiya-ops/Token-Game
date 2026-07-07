/**
 * Session-receiver HTTP routes.
 *
 * Mounted by createGameApp (apps/server/src/index.ts) at /v1/sessions.
 * This is the live token-ingestion HTTP surface; the old trust-batch
 * receiver was removed after the migration window.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { appendEvent, readLedger } from '../store';
import { tokenEventToQi } from '@token-game/shared';
import {
  applyTick,
  closeSession,
  evaluateManualRefresh,
  MIN_MANUAL_REFRESH_INTERVAL_MS,
  openSession,
  parseTickRequest,
  readSessionStore,
  registerDevice,
  resolveSessionStorePath,
  signTick,
  SESSION_MAX_IDLE_MS,
  sweepIdleSessions,
  verifyCursorMonotonicity,
  verifyTickSignature,
  writeSessionStore,
  generateDeviceKey
} from './index';
import type {
  CloseSessionRequest,
  FileSnapshot,
  OpenSessionRequest,
  OpenSessionResponse,
  SessionBucketDelta,
  TickResponse
} from './types';
import type { SessionDriver } from '../token-tracker/session-driver';

/** Locate the on-disk store path. Order of resolution:
 *   1. per-app override passed via createSessionRoutes({storePath})
 *   2. env `TOKEN_GAME_SESSION_STORE`
 *   3. resolver default (apps/server/data/sessions.json)
 */
function resolveStorePath(opts?: { storePath?: string }): string {
  if (opts?.storePath) return opts.storePath;
  const env = process.env.TOKEN_GAME_SESSION_STORE;
  if (env && env.trim().length > 0) return env;
  return resolveSessionStorePath();
}

export type SessionRouteOptions = {
  /** Override the on-disk store path. Tests pass a tmpdir. */
  storePath?: string;
  /** Optional SessionDriver. When present, the routes can hand off
   *  "立刻入账" actions to it without requiring a signed tick. */
  sessionDriver?: SessionDriver;
};

/** Apply a list of bucket deltas to the player ledger through
 *  `appendEvent`. Returns the qi and tokens gained. */
function applyDeltasToLedger(deltas: SessionBucketDelta[]) {
  let qi = 0;
  let tokens = 0;
  const bySource: Record<string, number> = {};
  const ledger = readLedger();
  for (const delta of deltas) {
    const tokenCount =
      delta.inputTokens +
      delta.cachedInputTokens +
      delta.outputTokens +
      delta.reasoningOutputTokens;
    if (tokenCount <= 0) continue;
    const qiGained = tokenEventToQi(tokenCount) + ledger.player.realmLevel * 2;
    // No per-bucket dedup on the server side: cursor monotonicity
    // (verifyCursorMonotonicity) guarantees we never see the same
    // range twice from a given device in one session.
    appendEvent({
      id: `session:${delta.key}:${tokenCount}`,
      source: 'tokentracker',
      model: delta.model,
      kind: 'input',
      tokenCount,
      occurredAt: delta.hourStart,
      metadata: {
        bucketKey: delta.key,
        tracker: 'session-receiver',
        inputTokens: delta.inputTokens,
        cachedInputTokens: delta.cachedInputTokens,
        outputTokens: delta.outputTokens,
        reasoningOutputTokens: delta.reasoningOutputTokens
      },
      qiGained
    });
    qi += qiGained;
    tokens += tokenCount;
    bySource[delta.source] = (bySource[delta.source] ?? 0) + tokenCount;
  }
  return { qi, tokens, bySource };
}

/** Wire all session routes onto the given Fastify app. */
export async function createSessionRoutes(
  app: FastifyInstance,
  options: SessionRouteOptions = {}
): Promise<void> {
  const storePath = options.storePath ?? resolveStorePath(options);
  const sessionDriver = options.sessionDriver ?? null;

  // Periodic sweep — close any device session that hasn't ticked in SESSION_MAX_IDLE_MS.
  const sweepInterval = setInterval(() => {
    const store = readSessionStore(storePath);
    const swept = sweepIdleSessions(store, { now: new Date(), maxIdleMs: SESSION_MAX_IDLE_MS });
    if (swept > 0) writeSessionStore(store, storePath);
  }, 60_000);
  if (typeof (sweepInterval as { unref?: () => unknown }).unref === 'function') {
    (sweepInterval as { unref: () => unknown }).unref();
  }
  app.addHook('onClose', async () => {
    clearInterval(sweepInterval);
  });

  // ──────────────────────────────────────────────────────────────────
  // POST /v1/sessions — open a new session, mint or look-up device key.
  // ──────────────────────────────────────────────────────────────────
  app.post('/v1/sessions', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body ?? {}) as Partial<OpenSessionRequest> & { deviceKey?: unknown };
    let deviceKey: string;
    if (typeof body.deviceKey === 'string' && body.deviceKey.length >= 32) {
      // Resume path: client already minted and persisted a deviceKey.
      deviceKey = body.deviceKey;
    } else {
      deviceKey = generateDeviceKey();
    }
    const baselineCursors: FileSnapshot[] = Array.isArray(body.baselineCursors)
      ? body.baselineCursors
          .filter((s): s is FileSnapshot =>
            !!s &&
            typeof s === 'object' &&
            typeof (s as Partial<FileSnapshot>).providerId === 'string'
          )
          .map((s) => ({
            providerId: typeof s.providerId === 'string' ? s.providerId : '',
            path: typeof s.path === 'string' ? s.path : '',
            size: typeof s.size === 'number' && Number.isFinite(s.size) ? Math.max(0, Math.floor(s.size)) : 0,
            inode: typeof s.inode === 'number' && Number.isFinite(s.inode) ? Math.floor(s.inode) : null
          }))
      : [];

    // When a SessionDriver is mounted, route the open through it so the
    // driver captures the new session in its live map and starts the
    // scheduled ticker. Without this, manual-refresh / active endpoints
    // (which look up by live sessionId) return no_session.
    if (sessionDriver) {
      const result = await sessionDriver.startSession({
        deviceKey,
        baselineCursors,
        clientLabel: typeof body.clientLabel === 'string' ? body.clientLabel : null
      });
      if (!result.ok) {
        if (result.reason === 'session_already_open') {
          reply.code(409);
          return {
            error: 'session_already_open',
            message: 'A session is already open for this device.',
            existingSessionId: result.existing.sessionId
          };
        }
        reply.code(500);
        return { error: result.reason ?? 'session_open_failed' };
      }
      return result.response;
    }

    // Fallback path used when no SessionDriver is mounted (e.g. tests
    // that exercise the HTTP layer with enableSessionDriver: false).
    const store = readSessionStore(storePath);
    const openedAt = new Date().toISOString();
    registerDevice(store, { deviceKey, firstSeenAt: openedAt });
    const sessionId = randomUUID();
    const opened = openSession(store, {
      deviceKey,
      sessionId,
      baselineCursors,
      clientLabel: typeof body.clientLabel === 'string' ? body.clientLabel : null,
      openedAt
    });
    if (!opened.ok) {
      reply.code(409);
      return {
        error: 'session_already_open',
        message: 'A session is already open for this device.',
        existingSessionId: opened.existing.sessionId
      };
    }
    writeSessionStore(store, storePath);
    const response: OpenSessionResponse = {
      deviceKey,
      sessionId,
      manualRefreshMinIntervalMs: MIN_MANUAL_REFRESH_INTERVAL_MS,
      sessionMaxIdleMs: SESSION_MAX_IDLE_MS
    };
    return response;
  });

  // ──────────────────────────────────────────────────────────────────
  // POST /v1/sessions/:deviceKey/tick — apply a tick.
  // ──────────────────────────────────────────────────────────────────
  app.post('/v1/sessions/:deviceKey/tick', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as { deviceKey?: string };
    if (!params.deviceKey || params.deviceKey.length < 32) {
      reply.code(400);
      return { error: 'malformed', message: 'deviceKey is required.' };
    }
    const tick = parseTickRequest(request.body);
    if (!tick) {
      reply.code(400);
      return { error: 'malformed', message: 'Tick body is not a valid SessionTick.' };
    }
    if (tick.deviceKey !== params.deviceKey) {
      reply.code(400);
      return { error: 'key_mismatch', message: 'Tick deviceKey does not match URL.' };
    }
    if (!verifyTickSignature(tick)) {
      reply.code(401);
      return { error: 'invalid_signature', message: 'Tick signature is invalid.' };
    }
    const store = readSessionStore(storePath);
    const device = store.devices[tick.deviceKey];
    if (!device) {
      reply.code(404);
      return { error: 'device_unknown', message: 'No session has been opened for this device.' };
    }
    if (!device.openSession || device.openSession.sessionId !== tick.sessionId) {
      reply.code(409);
      return { error: 'session_closed', message: 'No open session matches this id.' };
    }

    // Manual-refresh rate-limit.
    if (tick.trigger === 'manual') {
      const decision = evaluateManualRefresh(
        new Date(),
        device.openSession.lastManualRefreshAt,
        MIN_MANUAL_REFRESH_INTERVAL_MS
      );
      if (!decision.allowed) {
        reply.code(429);
        reply.header('retry-after', Math.ceil(decision.retryAfterMs / 1000).toString());
        return {
          error: 'rate_limited',
          message: 'Manual refresh requested too soon.',
          retryAfterMs: decision.retryAfterMs,
          nextManualRefreshAllowedAt: decision.nextManualRefreshAllowedAt
        };
      }
    }

    // Cursor monotonicity — same key in `cursorAfter` must advance.
    const cursorProblem = verifyCursorMonotonicity(device.openSession, tick.cursorAfter);
    if (cursorProblem === 'cursor_regressed') {
      reply.code(409);
      return { error: 'cursor_regressed', message: 'cursorAfter contains a size smaller than the session had previously accepted.' };
    }
    if (cursorProblem === 'inode_changed') {
      reply.code(409);
      return { error: 'inode_changed', message: 'One of the watched files rotated; closing session. Reopen required.' };
    }
    if (cursorProblem === 'cursor_missing') {
      reply.code(400);
      return { error: 'cursor_missing', message: 'cursorAfter is missing a path the baseline or a prior tick reported.' };
    }

    const appliedAt = new Date().toISOString();
    const tickStart = Date.now();
    const applied = applyDeltasToLedger(tick.deltas);

    const audit =
      tick.trigger === 'manual'
        ? {
            at: appliedAt,
            deltasEmitted: tick.deltas.length,
            tickDurationMs: Math.max(0, Date.now() - tickStart)
          }
        : null;

    const tickOutcome = applyTick(store, {
      deviceKey: tick.deviceKey,
      sessionId: tick.sessionId,
      cursorAfter: tick.cursorAfter,
      deltas: tick.deltas,
      qiGained: applied.qi,
      tokensGained: applied.tokens,
      triggersBySource: applied.bySource,
      audit,
      appliedAt
    });
    if (!tickOutcome.ok) {
      reply.code(409);
      return { error: tickOutcome.reason };
    }
    writeSessionStore(store, storePath);

    const ledger = readLedger();
    const response: TickResponse = {
      ok: true,
      appliedAt,
      qiGained: applied.qi,
      totalTokens: ledger.player.totalTokens,
      triggersAppliedBySource: applied.bySource,
      nextManualRefreshAllowedAt:
        tick.trigger === 'manual'
          ? new Date(Date.now() + MIN_MANUAL_REFRESH_INTERVAL_MS).toISOString()
          : null,
      trigger: tick.trigger
    };
    return response;
  });

  // ──────────────────────────────────────────────────────────────────
  // POST /v1/sessions/:deviceKey/refresh — manual refresh.
  //
  // Same handler as `tick` but with `trigger: 'manual'` forced. The
  // desktop can use this endpoint for any "立刻入账" UX without
  // having to flag the trigger on the wire body.
  // ──────────────────────────────────────────────────────────────────
  app.post('/v1/sessions/:deviceKey/refresh', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as { deviceKey?: string };
    if (!params.deviceKey || params.deviceKey.length < 32) {
      reply.code(400);
      return { error: 'malformed', message: 'deviceKey is required.' };
    }
    // Reuse the same body shape but force `trigger = 'manual'`.
    const incoming = (request.body ?? {}) as Record<string, unknown>;
    const forced = {
      ...incoming,
      deviceKey: params.deviceKey,
      trigger: 'manual' as const,
      signature: typeof incoming.signature === 'string' ? incoming.signature : ''
    };
    const tick = parseTickRequest(forced);
    if (!tick) {
      reply.code(400);
      return { error: 'malformed', message: 'Refresh body is not a valid signed TickRequest.' };
    }
    if (!verifyTickSignature(tick)) {
      reply.code(401);
      return { error: 'invalid_signature', message: 'Tick signature is invalid.' };
    }
    const store = readSessionStore(storePath);
    const device = store.devices[tick.deviceKey];
    if (!device) {
      reply.code(404);
      return { error: 'device_unknown', message: 'No session open for this device.' };
    }
    if (!device.openSession) {
      reply.code(410);
      return { error: 'session_closed', message: 'Session is not open.' };
    }
    if (device.openSession.sessionId !== tick.sessionId) {
      reply.code(409);
      return { error: 'session_id_mismatch', message: 'Tick sessionId does not match the open session.' };
    }
    const decision = evaluateManualRefresh(
      new Date(),
      device.openSession.lastManualRefreshAt,
      MIN_MANUAL_REFRESH_INTERVAL_MS
    );
    if (!decision.allowed) {
      reply.code(429);
      reply.header('retry-after', Math.ceil(decision.retryAfterMs / 1000).toString());
      return {
        error: 'rate_limited',
        message: 'Manual refresh requested too soon.',
        retryAfterMs: decision.retryAfterMs,
        nextManualRefreshAllowedAt: decision.nextManualRefreshAllowedAt
      };
    }
    const cursorProblem = verifyCursorMonotonicity(device.openSession, tick.cursorAfter);
    if (cursorProblem) {
      reply.code(cursorProblem === 'cursor_missing' ? 400 : 409);
      return { error: cursorProblem };
    }
    const appliedAt = new Date().toISOString();
    const tickStart = Date.now();
    const applied = applyDeltasToLedger(tick.deltas);

    const tickOutcome = applyTick(store, {
      deviceKey: tick.deviceKey,
      sessionId: tick.sessionId,
      cursorAfter: tick.cursorAfter,
      deltas: tick.deltas,
      qiGained: applied.qi,
      tokensGained: applied.tokens,
      triggersBySource: applied.bySource,
      audit: {
        at: appliedAt,
        deltasEmitted: tick.deltas.length,
        tickDurationMs: Math.max(0, Date.now() - tickStart)
      },
      appliedAt
    });
    if (!tickOutcome.ok) {
      reply.code(409);
      return { error: tickOutcome.reason };
    }
    writeSessionStore(store, storePath);
    const ledger = readLedger();
    const response: TickResponse = {
      ok: true,
      appliedAt,
      qiGained: applied.qi,
      totalTokens: ledger.player.totalTokens,
      triggersAppliedBySource: applied.bySource,
      nextManualRefreshAllowedAt: new Date(
        Date.now() + MIN_MANUAL_REFRESH_INTERVAL_MS
      ).toISOString(),
      trigger: 'manual'
    };
    return response;
  });

  // ──────────────────────────────────────────────────────────────────
  // POST /v1/sessions/:deviceKey/close — close the open session.
  // ──────────────────────────────────────────────────────────────────
  app.post('/v1/sessions/:deviceKey/close', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as { deviceKey?: string };
    if (!params.deviceKey || params.deviceKey.length < 32) {
      reply.code(400);
      return { error: 'malformed', message: 'deviceKey is required.' };
    }
    const body = request.body as Partial<CloseSessionRequest> | null;
    if (
      !body ||
      typeof body.sessionId !== 'string' ||
      typeof body.clientTimestamp !== 'string' ||
      typeof body.signature !== 'string'
    ) {
      reply.code(400);
      return { error: 'malformed', message: 'close requires sessionId, clientTimestamp, and signature.' };
    }
    const deviceKey = params.deviceKey;
    const expected = signTick(
      {
        deviceKey,
        sessionId: body.sessionId,
        trigger: 'scheduled',
        clientTimestamp: body.clientTimestamp,
        deltas: [],
        cursorAfter: []
      },
      deviceKey
    );
    if (expected !== body.signature) {
      reply.code(401);
      return { error: 'invalid_signature', message: 'Close signature is invalid.' };
    }
    const store = readSessionStore(storePath);
    const closed = closeSession(store, {
      deviceKey,
      sessionId: body.sessionId,
      closedAt: new Date().toISOString()
    });
    if (!closed.ok) {
      reply.code(closed.reason === 'session_closed' ? 409 : 404);
      return { error: closed.reason };
    }
    writeSessionStore(store, storePath);
    return {
      ok: true,
      sessionId: closed.session.sessionId,
      endedAt: closed.session.endedAt,
      totalDeltas: closed.session.totalDeltas,
      totalQiGained: closed.session.totalQiGained
    };
  });

  // ──────────────────────────────────────────────────────────────────
  // GET /v1/sessions/:deviceKey — for the desktop & audit tools.
  // ──────────────────────────────────────────────────────────────────
  app.get('/v1/sessions/:deviceKey', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as { deviceKey?: string };
    if (!params.deviceKey || params.deviceKey.length < 32) {
      reply.code(400);
      return { error: 'malformed' };
    }
    const store = readSessionStore(storePath);
    const device = store.devices[params.deviceKey];
    if (!device) {
      reply.code(404);
      return { error: 'not_found' };
    }
    return {
      deviceKey: device.deviceKey,
      firstSeenAt: device.firstSeenAt,
      lastSeenAt: device.lastSeenAt,
      totalQiGained: device.totalQiGained,
      totalTokensAccepted: device.totalTokensAccepted,
      openSession: device.openSession,
      closedSessionCount: device.closedSessions.length,
      manualRefreshesCount: device.openSession
        ? device.openSession.manualRefreshes.length
        : 0
    };
  });

  // ──────────────────────────────────────────────────────────────────
  // GET /v1/sessions/active — used by the web dashboard to discover
  // which deviceKey is currently in use. The server returns the
  // device with the most recent lastSeenAt that has an open session.
  // Designed for single-user desktop deployments.
  // ──────────────────────────────────────────────────────────────────
  app.get('/v1/sessions/active', async (_request: FastifyRequest, reply: FastifyReply) => {
    if (!sessionDriver) {
      reply.code(503);
      return { error: 'session_driver_disabled' };
    }
    const deviceKey = sessionDriver.activeDeviceKey();
    if (!deviceKey) {
      reply.code(404);
      return { error: 'no_active_session' };
    }
    const ledger = readLedger();
    return {
      deviceKey,
      totalTokens: ledger.player.totalTokens,
      qi: ledger.player.qi
    };
  });

  // ──────────────────────────────────────────────────────────────────
  // POST /v1/sessions/active/manual-refresh — server-side manual tick
  // targeting the most recently active device. Used by the web
  // dashboard which doesn't know the deviceKey.
  // ──────────────────────────────────────────────────────────────────
  app.post('/v1/sessions/active/manual-refresh', async (_request: FastifyRequest, reply: FastifyReply) => {
    if (!sessionDriver) {
      reply.code(503);
      return { error: 'session_driver_disabled' };
    }
    const deviceKey = sessionDriver.activeDeviceKey();
    if (!deviceKey) {
      reply.code(404);
      return { error: 'no_active_session' };
    }
    const result = await sessionDriver.manualRefreshByDeviceKey({ deviceKey });
    if (!result.ok) {
      if (result.reason === 'rate_limited') {
        reply.code(429);
        reply.header('retry-after', Math.ceil((result.retryAfterMs ?? 5_000) / 1000).toString());
        return {
          error: 'rate_limited',
          retryAfterMs: result.retryAfterMs ?? 5_000,
          nextManualRefreshAllowedAt: result.nextManualRefreshAllowedAt
        };
      }
      reply.code(500);
      return { error: result.reason };
    }
    const ledger = readLedger();
    return {
      ok: true,
      deviceKey,
      qiGained: result.qiGained,
      eventsEmitted: result.eventsEmitted,
      totalTokens: ledger.player.totalTokens,
      triggersAppliedBySource: result.triggersAppliedBySource ?? {}
    };
  });

  // ──────────────────────────────────────────────────────────────────
  // POST /v1/sessions/:deviceKey/manual-refresh — server-side manual
  // tick. The desktop doesn't have cursor state, so it can't
  // construct a signed TickRequest; the SessionDriver handles the
  // whole thing in-process. This is the endpoint the desktop's
  // "立刻入账" call talks to.
  // ──────────────────────────────────────────────────────────────────
  app.post('/v1/sessions/:deviceKey/manual-refresh', async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as { deviceKey?: string };
    if (!params.deviceKey || params.deviceKey.length < 32) {
      reply.code(400);
      return { error: 'malformed', message: 'deviceKey is required.' };
    }
    if (!sessionDriver) {
      reply.code(503);
      return { error: 'session_driver_disabled' };
    }
    const result = await sessionDriver.manualRefreshByDeviceKey({ deviceKey: params.deviceKey });
    if (!result.ok) {
      if (result.reason === 'rate_limited') {
        reply.code(429);
        reply.header('retry-after', Math.ceil((result.retryAfterMs ?? 5_000) / 1000).toString());
        return {
          error: 'rate_limited',
          retryAfterMs: result.retryAfterMs ?? 5_000,
          nextManualRefreshAllowedAt: result.nextManualRefreshAllowedAt
        };
      }
      if (result.reason === 'no_session') {
        reply.code(409);
        return { error: 'no_session' };
      }
      reply.code(500);
      return { error: result.reason };
    }
    const ledger = readLedger();
    return {
      ok: true,
      deviceKey: params.deviceKey,
      qiGained: result.qiGained,
      eventsEmitted: result.eventsEmitted,
      totalTokens: ledger.player.totalTokens,
      triggersAppliedBySource: result.triggersAppliedBySource ?? {}
    };
  });
}
