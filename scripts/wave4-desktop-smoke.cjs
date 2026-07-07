#!/usr/bin/env node
/**
 * Wave 4.4 — real desktop smoke (in-process).
 *
 * Loads the *real* production server bundle (apps/server/dist/index.cjs)
 * and calls `startGameServer({...})` to bind port 3001. Then drives the
 * *actual* desktop session-client.cjs (no mocks, no Electron) to open a
 * session, manually refresh, and close.
 *
 * Asserts:
 *   1. server boots and listens on 3001
 *   2. /v1/sessions POST returns deviceKey + sessionId
 *   3. session-client.startSession writes session.json to userData
 *   4. session-client.manualRefresh returns triggersAppliedBySource > 0
 *   5. the ledger file in $TOKEN_GAME_DATA_DIR has fresh tokentracker events
 *   6. session-client.stopSession clears sessionId in session.json
 */

const path = require('node:path');
const {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync
} = require('node:fs');
const os = require('node:os');
const http = require('node:http');

const ROOT = 'C:\\Users\\19813\\WorkSpace\\Token-Game';
const SERVER_ENTRY = path.join(ROOT, 'apps', 'server', 'dist', 'index.cjs');
const SESSION_CLIENT = path.join(ROOT, 'desktop', 'session-client.cjs');

const checks = [];
function pass(name, detail = '') {
  checks.push({ ok: true, name, detail });
  console.log(`[smoke] PASS: ${name}${detail ? ' — ' + detail : ''}`);
}
function fail(name, detail = '') {
  checks.push({ ok: false, name, detail });
  console.error(`[smoke] FAIL: ${name}${detail ? ' — ' + detail : ''}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function waitForServer(port, host, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.request(
        { host, port, path: '/health', method: 'GET', timeout: 500 },
        (res) => {
          res.resume();
          if (res.statusCode === 200) return resolve();
          retry();
        }
      );
      req.on('error', retry);
      req.on('timeout', () => req.destroy(retry));
      req.end();
    };
    const retry = () => {
      if (Date.now() > deadline) {
        return reject(new Error(`server did not become ready on ${host}:${port} within ${timeoutMs}ms`));
      }
      setTimeout(tryOnce, 100);
    };
    tryOnce();
  });
}

async function main() {
  const stamp = Date.now();
  const fakeHome = mkdtempSync(path.join(os.tmpdir(), `tg-smoke-home-${stamp}-`));
  const userData = mkdtempSync(path.join(os.tmpdir(), `tg-smoke-userdata-${stamp}-`));
  const dataDir = mkdtempSync(path.join(os.tmpdir(), `tg-smoke-data-${stamp}-`));

  console.log(`[smoke] fakeHome = ${fakeHome}`);
  console.log(`[smoke] userData = ${userData}`);
  console.log(`[smoke] dataDir = ${dataDir}`);

  // 1. fake Claude JSONL log under fakeHome/.claude/projects
  const claudeDir = path.join(fakeHome, '.claude', 'projects');
  mkdirSync(claudeDir, { recursive: true });
  const fakeSessionId = `smoke-wave4-${stamp}`;
  const logFile = path.join(claudeDir, `${fakeSessionId}.jsonl`);
  // Baseline empty file so listFiles() picks it up; we'll append a real
  // entry *after* the SessionDriver captures the empty-file baseline.
  writeFileSync(logFile, '');
  pass(`empty Claude JSONL placeholder at ${path.relative(ROOT, logFile)}`);

  // 2. Pretend fakeHome is the user's HOME so os.homedir() (used by
  //    the provider registry) returns it. We mutate os.homedir via
  //    process.env because dist/index.cjs passes process.env to
  //    getDefaultProviders on the next tick.
  process.env.USERPROFILE = fakeHome;
  process.env.HOME = fakeHome;
  process.env.TOKEN_GAME_DATA_DIR = dataDir;

  // 3. Boot the real server bundle in-process
  // Force dist to resolve providers against our fakeHome by patching
  // the homedir() return value via a require-time shim.
  const Module = require('node:module');
  const origHomedir = require('node:os').homedir;
  require('node:os').homedir = () => fakeHome;

  const serverModule = require(SERVER_ENTRY);
  const serverApp = await serverModule.startGameServer({
    port: 3001,
    host: '127.0.0.1',
    // Make the SessionDriver tick fast so manual-refresh sees the
    // freshly written JSONL right away (even if our sleep is short).
    sessionDriverTickIntervalMs: 1_000,
    // Tell the server to write ledger/session-store under our tmp dir.
    sessionStorePath: path.join(dataDir, 'sessions.json'),
    staticRoot: path.join(ROOT, 'apps', 'web', 'dist')
  });

  // Restore os.homedir() so subsequent session-client calls in the same
  // process don't get confused. The server already captured the value.
  require('node:os').homedir = origHomedir;

  let serverError = null;
  // addHook already disallowed because the server is listening by the
  // time startGameServer returns. Skip and rely on stdout.

  let gameServerClosed = false;
  try {
    // 4. wait for server to be ready
    await waitForServer(3001, '127.0.0.1');
    pass('server health endpoint OK on 127.0.0.1:3001');

    // also probe /health/session-driver to confirm SessionDriver booted
    const driverHealth = await new Promise((resolve, reject) => {
      const req = http.request(
        { host: '127.0.0.1', port: 3001, path: '/health/session-driver', method: 'GET', timeout: 500 },
        (res) => {
          let body = '';
          res.on('data', (c) => (body += c));
          res.on('end', () => resolve({ status: res.statusCode, body }));
        }
      );
      req.on('error', reject);
      req.end();
    });
    if (driverHealth.status !== 200) {
      fail('session-driver health check non-200', JSON.stringify(driverHealth));
    } else {
      pass(`session-driver health ${driverHealth.body}`);
    }

    // 5. drive session-client.cjs (real desktop client, no Electron)
    delete require.cache[require.resolve(SESSION_CLIENT)];
    const sessionClient = require(SESSION_CLIENT);

    const opened = await sessionClient.startSession(userData);
    if (!opened.deviceKey || !opened.sessionId) {
      fail('startSession did not return deviceKey/sessionId', JSON.stringify(opened));
    } else {
      pass(
        `session opened`,
        `deviceKey=${opened.deviceKey.slice(0, 12)}… sessionId=${opened.sessionId.slice(0, 8)}…`
      );
    }

    const sessionFile = path.join(userData, 'session.json');
    if (!existsSync(sessionFile)) {
      fail('session.json was not written to userData', sessionFile);
    } else {
      const parsed = JSON.parse(readFileSync(sessionFile, 'utf8'));
      if (parsed.deviceKey !== opened.deviceKey || parsed.sessionId !== opened.sessionId) {
        fail('session.json contents disagree with startSession response', JSON.stringify(parsed));
      } else {
        pass('session.json persisted with matching deviceKey/sessionId');
      }
    }

    // give the SessionDriver a beat to register the live session
    await sleep(400);

    // 5b. NOW write the real Claude JSONL line so the cursor advances
    //     and manual-refresh sees fresh bytes after the baseline.
    const now = new Date();
    const hourStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      now.getHours()
    ).toISOString();
    const fakeLine = JSON.stringify({
      timestamp: hourStart,
      type: 'assistant',
      message: {
        id: `msg_${stamp}_1`,
        model: 'claude-sonnet-4-20250514',
        usage: {
          input_tokens: 1234,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          output_tokens: 567
        }
      }
    });
    writeFileSync(logFile, fakeLine + '\n');
    pass('appended fake Claude assistant line after baseline');

    // 6. manual refresh — the desktop "立刻入账" path
    const refreshed = await sessionClient.manualRefresh(userData);
    if (!refreshed.ok) {
      fail('manualRefresh did not succeed', JSON.stringify(refreshed));
    } else {
      const triggers = refreshed.triggersAppliedBySource ?? {};
      const triggerKeys = Object.keys(triggers);
      if (triggerKeys.length === 0) {
        fail(
          'manualRefresh ok=true but no triggersAppliedBySource',
          'expected at least one provider'
        );
      } else {
        pass(`manualRefresh applied tokens by source: ${JSON.stringify(triggers)}`);
      }
    }

    // 7. verify the ledger was updated
    const ledgerPath = path.join(dataDir, 'ledger.json');
    if (!existsSync(ledgerPath)) {
      fail('ledger.json not written under dataDir', ledgerPath);
    } else {
      const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
      const tokentrackerEvents = (ledger.events ?? []).filter((e) => e.source === 'tokentracker');
      if (tokentrackerEvents.length === 0) {
        fail('ledger has no tokentracker-sourced events');
      } else {
        const totalFromTracker = tokentrackerEvents.reduce((s, e) => s + e.tokenCount, 0);
        pass(
          `ledger has ${tokentrackerEvents.length} tokentracker events totaling ${totalFromTracker} tokens`,
          `latest model=${tokentrackerEvents[tokentrackerEvents.length - 1].model}`
        );
      }
    }

    // 8. stop session — should clear sessionId in session.json
    await sessionClient.stopSession(userData);
    const afterClose = JSON.parse(readFileSync(sessionFile, 'utf8'));
    if (afterClose.sessionId !== null) {
      fail('stopSession did not clear sessionId', `got ${afterClose.sessionId}`);
    } else if (afterClose.deviceKey !== opened.deviceKey) {
      fail(
        'stopSession clobbered deviceKey',
        `was ${opened.deviceKey.slice(0, 12)}…, now ${afterClose.deviceKey}`
      );
    } else {
      pass('stopSession cleared sessionId while preserving deviceKey');
    }
  } catch (err) {
    fail('uncaught', err && err.stack ? err.stack : String(err));
  } finally {
    if (!gameServerClosed) {
      try {
        await serverApp.close();
        gameServerClosed = true;
      } catch (e) {
        // ignore
      }
    }
    try { rmSync(fakeHome, { recursive: true, force: true }); } catch {}
    try { rmSync(userData, { recursive: true, force: true }); } catch {}
    try { rmSync(dataDir, { recursive: true, force: true }); } catch {}
  }

  const passed = checks.filter((c) => c.ok).length;
  const failed = checks.length - passed;
  console.log(`[smoke] ===== ${passed}/${checks.length} passed, ${failed} failed =====`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error('[smoke] top-level crash:', err);
  process.exit(1);
});