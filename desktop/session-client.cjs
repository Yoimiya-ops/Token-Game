/**
 * Desktop-side session client.
 *
 * The server owns the actual token collection loop. Desktop only opens a
 * session on launch, persists the device key, asks for manual refresh when
 * the user clicks, and closes the session on quit.
 */

const { createHmac } = require('node:crypto');
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const SERVER_URL = 'http://127.0.0.1:3001';
const OPEN_PATH = '/v1/sessions';
const ACTIVE_PATH = '/v1/sessions/active';
const MANUAL_REFRESH_PATH = '/v1/sessions/:key/manual-refresh';
const FETCH_TIMEOUT_MS = 5_000;
const SESSION_FILE = 'session.json';

let cached = null;

function sessionFilePath(userData) {
  return path.join(userData, SESSION_FILE);
}

function emptyState() {
  return { deviceKey: null, sessionId: null, lastRefreshAt: null, lastRefreshStatus: null };
}

function readSessionFile(userData) {
  const file = sessionFilePath(userData);
  if (!existsSync(file)) return emptyState();
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    return {
      deviceKey: typeof parsed?.deviceKey === 'string' ? parsed.deviceKey : null,
      sessionId: typeof parsed?.sessionId === 'string' ? parsed.sessionId : null,
      lastRefreshAt: typeof parsed?.lastRefreshAt === 'string' ? parsed.lastRefreshAt : null,
      lastRefreshStatus:
        parsed?.lastRefreshStatus === 'ok' ||
        parsed?.lastRefreshStatus === 'rate_limited' ||
        parsed?.lastRefreshStatus === 'error'
          ? parsed.lastRefreshStatus
          : null
    };
  } catch {
    return emptyState();
  }
}

function persist(userData, data) {
  if (!existsSync(userData)) mkdirSync(userData, { recursive: true });
  writeFileSync(sessionFilePath(userData), JSON.stringify(data, null, 2));
}

async function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function canonicaliseClosePayload(deviceKey, sessionId, clientTimestamp) {
  // MUST stay byte-identical to apps/server/src/session-receiver/validate.ts
  // `canonicaliseTick`. Sort order: cursorAfter by (providerId, path),
  // deltas by `key`, top-level fields in the documented order. Both sides
  // hardcode the order — switching either side to a recursive key-sort
  // will diverge from the other.
  return JSON.stringify({
    deviceKey,
    sessionId,
    trigger: 'scheduled',
    clientTimestamp,
    deltas: [],
    cursorAfter: []
  });
}

function signCloseRequest(deviceKey, sessionId, clientTimestamp) {
  return createHmac('sha256', deviceKey)
    .update(canonicaliseClosePayload(deviceKey, sessionId, clientTimestamp))
    .digest('hex');
}

async function startSession(userData) {
  const persisted = readSessionFile(userData);
  cached = { userData, data: persisted };

  const body = {};
  if (persisted.deviceKey) {
    body.deviceKey = persisted.deviceKey;
    body.clientLabel = 'desktop';
  }

  const response = await fetchWithTimeout(`${SERVER_URL}${OPEN_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (response.status === 409) {
    const conflict = await response.json().catch(() => ({}));
    if (persisted.deviceKey && typeof conflict?.existingSessionId === 'string') {
      const next = { ...persisted, sessionId: conflict.existingSessionId };
      persist(userData, next);
      cached = { userData, data: next };
      return { deviceKey: persisted.deviceKey, sessionId: conflict.existingSessionId };
    }
  }

  if (!response.ok) {
    return { error: `openSession failed: ${response.status} ${await response.text()}` };
  }

  const json = await response.json();
  const next = {
    ...persisted,
    deviceKey: json.deviceKey,
    sessionId: json.sessionId
  };
  persist(userData, next);
  cached = { userData, data: next };
  return { deviceKey: json.deviceKey, sessionId: json.sessionId };
}

async function stopSession(userData) {
  const persisted = readSessionFile(userData);
  if (!persisted.deviceKey || !persisted.sessionId) return;

  const clientTimestamp = new Date().toISOString();
  const signature = signCloseRequest(persisted.deviceKey, persisted.sessionId, clientTimestamp);
  try {
    await fetchWithTimeout(`${SERVER_URL}/v1/sessions/${persisted.deviceKey}/close`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sessionId: persisted.sessionId,
        clientTimestamp,
        signature
      })
    });
  } catch {
    // Best-effort. Server will sweep via the idle hook if close cannot be sent.
  }

  const next = { ...persisted, sessionId: null };
  persist(userData, next);
  cached = { userData, data: next };
}

async function manualRefresh(userData) {
  const persisted = readSessionFile(userData);
  if (!persisted.deviceKey || !persisted.sessionId) {
    return { ok: false, reason: 'no_session', message: 'No open session — restart the app to begin a new one.' };
  }

  const url = `${SERVER_URL}${MANUAL_REFRESH_PATH}`.replace(':key', persisted.deviceKey);
  try {
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({})
    });

    if (response.status === 429) {
      const body = await response.json().catch(() => ({}));
      const next = {
        ...persisted,
        lastRefreshAt: new Date().toISOString(),
        lastRefreshStatus: 'rate_limited'
      };
      persist(userData, next);
      cached = { userData, data: next };
      return {
        ok: false,
        reason: 'rate_limited',
        retryAfterMs: typeof body?.retryAfterMs === 'number' ? body.retryAfterMs : 5_000,
        message: body?.message ?? 'Manual refresh rate-limited.'
      };
    }

    if (!response.ok) {
      const text = await response.text();
      const next = {
        ...persisted,
        lastRefreshAt: new Date().toISOString(),
        lastRefreshStatus: 'error'
      };
      persist(userData, next);
      cached = { userData, data: next };
      return { ok: false, reason: 'http_error', message: `HTTP ${response.status}: ${text}` };
    }

    const body = await response.json();
    const next = {
      ...persisted,
      lastRefreshAt: new Date().toISOString(),
      lastRefreshStatus: 'ok'
    };
    persist(userData, next);
    cached = { userData, data: next };
    return {
      ok: true,
      deviceKey: persisted.deviceKey,
      totalTokens: typeof body.totalTokens === 'number' ? body.totalTokens : 0,
      qiGained: typeof body.qiGained === 'number' ? body.qiGained : 0,
      triggersAppliedBySource: body.triggersAppliedBySource ?? {}
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const next = {
      ...persisted,
      lastRefreshAt: new Date().toISOString(),
      lastRefreshStatus: 'error'
    };
    persist(userData, next);
    cached = { userData, data: next };
    return { ok: false, reason: 'http_error', message };
  }
}

async function getActiveSessionInfo(userData) {
  try {
    const response = await fetchWithTimeout(`${SERVER_URL}${ACTIVE_PATH}`);
    if (!response.ok) return null;
    const body = await response.json();
    const persisted = readSessionFile(userData);
    return {
      deviceKey: persisted.deviceKey ?? body.deviceKey,
      sessionId: persisted.sessionId,
      totalTokens: typeof body.totalTokens === 'number' ? body.totalTokens : 0,
      lastRefreshAt: persisted.lastRefreshAt
    };
  } catch {
    return null;
  }
}

function getCached() {
  return cached?.data ?? null;
}

module.exports = {
  startSession,
  stopSession,
  manualRefresh,
  getActiveSessionInfo,
  getCached,
  readSessionFile,
  signCloseRequest,
  SESSION_FILE
};
