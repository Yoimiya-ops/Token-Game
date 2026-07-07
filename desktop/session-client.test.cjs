const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  SESSION_FILE,
  manualRefresh,
  readSessionFile,
  signCloseRequest,
  stopSession
} = require('./session-client.cjs');

function tempUserData() {
  return mkdtempSync(path.join(tmpdir(), 'token-game-session-client-'));
}

function writeSession(userData, data) {
  writeFileSync(path.join(userData, SESSION_FILE), JSON.stringify(data, null, 2));
}

test('manualRefresh posts to the server-side manual-refresh endpoint', async () => {
  const dir = tempUserData();
  const originalFetch = global.fetch;
  const deviceKey = 'a'.repeat(64);
  try {
    writeSession(dir, {
      deviceKey,
      sessionId: 'session-1',
      lastRefreshAt: null,
      lastRefreshStatus: null
    });

    let seenUrl = '';
    let seenMethod = '';
    global.fetch = async (url, init) => {
      seenUrl = String(url);
      seenMethod = init?.method ?? '';
      return new Response(JSON.stringify({
        totalTokens: 123,
        qiGained: 7,
        triggersAppliedBySource: { claude: 123 }
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    };

    const result = await manualRefresh(dir);

    assert.equal(seenUrl, `http://127.0.0.1:3001/v1/sessions/${deviceKey}/manual-refresh`);
    assert.equal(seenMethod, 'POST');
    assert.deepEqual(result, {
      ok: true,
      deviceKey,
      totalTokens: 123,
      qiGained: 7,
      triggersAppliedBySource: { claude: 123 }
    });
    assert.equal(readSessionFile(dir).lastRefreshStatus, 'ok');
  } finally {
    global.fetch = originalFetch;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('stopSession signs the close request instead of sending a blank signature', async () => {
  const dir = tempUserData();
  const originalFetch = global.fetch;
  const deviceKey = 'b'.repeat(64);
  try {
    writeSession(dir, {
      deviceKey,
      sessionId: 'session-2',
      lastRefreshAt: null,
      lastRefreshStatus: null
    });

    let body = null;
    global.fetch = async (_url, init) => {
      body = JSON.parse(String(init?.body ?? '{}'));
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    };

    await stopSession(dir);

    assert.equal(body.sessionId, 'session-2');
    assert.match(body.signature, /^[0-9a-f]{64}$/);
    assert.notEqual(body.signature, '');
    assert.equal(readSessionFile(dir).sessionId, null);
  } finally {
    global.fetch = originalFetch;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('signCloseRequest is deterministic for the same payload', () => {
  const signature = signCloseRequest('c'.repeat(64), 'session-3', '2026-07-07T00:00:00.000Z');
  assert.equal(signature, signCloseRequest('c'.repeat(64), 'session-3', '2026-07-07T00:00:00.000Z'));
  assert.match(signature, /^[0-9a-f]{64}$/);
});
