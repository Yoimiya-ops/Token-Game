/**
 * Session-based token collection — end-to-end acceptance script.
 *
 * Stands up the game server on a random local port, then walks the
 * session lifecycle:
 *   1. open session  → mint deviceKey, get sessionId
 *   2. close right away → player.qi is still 0
 *   3. open again → send a tick with deltas → player.qi reflects tokens
 *   4. send another tick with empty deltas → no-op (no double-counting)
 *   5. send a tick that regresses the cursor → 409
 *   6. close session → tick again → 410
 *   7. open again, two manual refreshes inside the rate-limit window →
 *      second is 429 with retry-after
 *
 * Mirrors § 验收标准 案例 1, 2, 4, 5, 6, 11 from
 * docs/design/session-based-token-collection.md.
 *
 * Usage:
 *   pnpm --filter @token-game/server verify:session
 *
 * Exit code 0 = every check passed. Non-zero = at least one failed.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGameApp } from '../src/index';
import { readLedger, writeLedger } from '../src/store';
import { signTick } from '../src/session-receiver/validate';
import type { FileCursor, TickRequest } from '../src/session-receiver/types';

type Result = { name: string; pass: boolean; detail?: string };
const results: Result[] = [];

function record(name: string, pass: boolean, detail?: string): void {
  results.push(detail !== undefined ? { name, pass, detail } : { name, pass });
  const tag = pass ? '\u001b[32mPASS\u001b[0m' : '\u001b[31mFAIL\u001b[0m';
  const suffix = detail ? `  \u2014  ${detail}` : '';
  console.log(`  ${tag}  ${name}${suffix}`);
}

function section(title: string): void {
  console.log('');
  console.log(`\u001b[1m\u001b[36m== ${title} ==\u001b[0m`);
}

// ────────────────────────────────────────────────────────────────────────
// Setup: isolated temp data dir so we never touch the developer's real
// ledger. Reset the ledger to a known-clean state for the duration of
// this verification run.
// ────────────────────────────────────────────────────────────────────────

const dataDir = mkdtempSync(join(tmpdir(), 'tg-verify-session-'));
process.env.TOKEN_GAME_DATA_DIR = dataDir;
const sessionStorePath = join(dataDir, 'sessions.json');

console.log(`\u001b[1m\u001b[35mToken-Game :: session-based collection verifier\u001b[0m`);
console.log(`  data dir      : ${dataDir}`);
console.log(`  session store : ${sessionStorePath}`);

// Reset ledger to a fresh state so ledger reads return 0s.
writeLedger({
  version: 1,
  player: {
    kittenName: 'verifier-cat',
    realm: '',
    realmLevel: 0,
    qi: 0,
    cultivation: 0,
    food: 0,
    foodGained: 0,
    spiritStone: 0,
    spiritHerb: 0,
    pills: 0,
    totalTokens: 0,
    lastFedAt: null,
    kindling: 0
  } as any,
  events: [],
  trackerState: {
    bucketTokens: {},
    lastSyncedAt: null,
    kindlingBackfilledAt: null
  },
  homestead: {
    omen: null,
    treasureBasin: { dayKey: null, dailyCondenses: 0, lastCondensedAt: null },
    spiritBeast: { name: '青霜', status: 'idle', route: null, lastDispatchedAt: null, returnsAt: null },
    inventory: [],
    logs: []
  }
} as any);

// Build the app. We pick an explicit port=0 (random free port) so we
// never collide with the dev server the developer may be running.
const app = await createGameApp({ sessionStorePath });
const address = await app.listen({ port: 0, host: '127.0.0.1' });
const baseUrl = address.replace(/\[::\]/, '127.0.0.1');

async function call(
  method: 'POST' | 'GET',
  path: string,
  body?: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: any; raw: Response }> {
  const opts: RequestInit = {
    method,
    headers: { 'content-type': 'application/json', ...headers }
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const raw = await fetch(`${baseUrl}${path}`, opts);
  let parsed: any = null;
  try {
    parsed = await raw.json();
  } catch {
    parsed = null;
  }
  return { status: raw.status, body: parsed, raw };
}

function makeSignedTick(args: {
  deviceKey: string;
  sessionId: string;
  trigger: 'scheduled' | 'manual';
  cursorAfter: FileCursor[];
  deltas?: import('../src/session-receiver/types').SessionBucketDelta[];
}): TickRequest {
  const partial: Omit<TickRequest, 'signature'> = {
    deviceKey: args.deviceKey,
    sessionId: args.sessionId,
    trigger: args.trigger,
    clientTimestamp: new Date().toISOString(),
    deltas: args.deltas ?? [],
    cursorAfter: args.cursorAfter
  };
  return { ...partial, signature: signTick(partial, args.deviceKey) };
}

function makeDelta(source: string, model: string, tokens: number) {
  const hourStart = '2026-07-07T00:00:00.000Z';
  return {
    key: `${source}|${model}|${hourStart}|input`,
    source,
    model,
    hourStart,
    inputTokens: tokens,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0
  };
}

/** Sign a close request and call the server. The client passes its
 *  own clientTimestamp so the server can verify the signature
 *  (the server's "now" would otherwise be a few ms later and the
 *  signatures would never line up). */
async function closeSession(deviceKey: string, sessionId: string) {
  const ts = new Date().toISOString();
  const sig = signTick(
    {
      deviceKey,
      sessionId,
      trigger: 'scheduled',
      clientTimestamp: ts,
      deltas: [],
      cursorAfter: []
    },
    deviceKey
  );
  return call('POST', `/v1/sessions/${deviceKey}/close`, {
    sessionId,
    clientTimestamp: ts,
    signature: sig
  });
}

// ────────────────────────────────────────────────────────────────────────
// Case 1: open + immediate close → player.qi = 0
// ────────────────────────────────────────────────────────────────────────
section('Case 1: open → close → no token in');

{
  const res = await call('POST', '/v1/sessions', {
    baselineCursors: [snapshot('/claude.jsonl', 'claude-code', 1024, 1)]
  });
  const ok = res.status === 200 && typeof res.body?.deviceKey === 'string' && typeof res.body?.sessionId === 'string';
  record('open session returns 200 + deviceKey + sessionId', ok, `status=${res.status}`);
  if (!ok) throw new Error('aborting: case 1 setup failed');

  const { deviceKey, sessionId } = res.body;
  const closeRes = await closeSession(deviceKey, sessionId);
  record('close session returns 200', closeRes.status === 200, `status=${closeRes.status}`);

  const ledger = readLedger();
  record('player.qi is 0 after open+close with no deltas', ledger.player.qi === 0, `qi=${ledger.player.qi}`);
  record('player.totalTokens is 0 after open+close with no deltas', ledger.player.totalTokens === 0, `totalTokens=${ledger.player.totalTokens}`);
}

// ────────────────────────────────────────────────────────────────────────
// Case 2: open + tick with deltas → player.qi reflects tokens
// ────────────────────────────────────────────────────────────────────────
section('Case 2: open → tick → player.qi grows by qiForTokens');

{
  const res = await call('POST', '/v1/sessions', {
    baselineCursors: [snapshot('/claude.jsonl', 'claude-code', 1024, 1)]
  });
  assert.equal(res.status, 200);
  const { deviceKey, sessionId } = res.body;

  const tick = makeSignedTick({
    deviceKey,
    sessionId,
    trigger: 'scheduled',
    cursorAfter: [{ providerId: 'claude-code', path: '/claude.jsonl', size: 2048, inode: 1 }],
    deltas: [makeDelta('claude-code', 'gpt-4', 1000)]
  });
  const tickRes = await call('POST', `/v1/sessions/${deviceKey}/tick`, tick);
  record('tick returns 200', tickRes.status === 200, `status=${tickRes.status} body=${JSON.stringify(tickRes.body)}`);

  // 1000 tokens → tokenEventToQi = max(1, floor(1000/100)) = 10
  // + realmLevel 0 * 2 = 0; total qiGained = 10
  const ledger = readLedger();
  record('player.qi reflects the 1000-token tick (≥10)', ledger.player.qi >= 10, `qi=${ledger.player.qi}`);
  record('player.totalTokens reflects the tick (≥1000)', ledger.player.totalTokens >= 1000, `totalTokens=${ledger.player.totalTokens}`);

  await closeSession(deviceKey, sessionId);
}

// ────────────────────────────────────────────────────────────────────────
// Case 3: tick with empty deltas is a no-op
// ────────────────────────────────────────────────────────────────────────
section('Case 3: empty deltas tick → no-op');

{
  const res = await call('POST', '/v1/sessions', {
    baselineCursors: [snapshot('/claude.jsonl', 'claude-code', 1024, 1)]
  });
  const { deviceKey, sessionId } = res.body;

  const before = readLedger().player.qi;
  const tick = makeSignedTick({
    deviceKey,
    sessionId,
    trigger: 'scheduled',
    cursorAfter: [{ providerId: 'claude-code', path: '/claude.jsonl', size: 2048, inode: 1 }],
    deltas: []
  });
  const tickRes = await call('POST', `/v1/sessions/${deviceKey}/tick`, tick);
  record('empty-deltas tick returns 200', tickRes.status === 200, `status=${tickRes.status}`);
  const after = readLedger().player.qi;
  record('player.qi did not change on empty deltas', after === before, `before=${before} after=${after}`);

  await closeSession(deviceKey, sessionId);
}

// ────────────────────────────────────────────────────────────────────────
// Case 4: cursor regression → 409
// ────────────────────────────────────────────────────────────────────────
section('Case 4: cursor regression → 409');

{
  const res = await call('POST', '/v1/sessions', {
    baselineCursors: [snapshot('/claude.jsonl', 'claude-code', 1024, 1)]
  });
  const { deviceKey, sessionId } = res.body;

  // First advance the cursor.
  const first = makeSignedTick({
    deviceKey,
    sessionId,
    trigger: 'scheduled',
    cursorAfter: [{ providerId: 'claude-code', path: '/claude.jsonl', size: 4096, inode: 1 }],
    deltas: [makeDelta('claude-code', 'gpt-4', 1000)]
  });
  await call('POST', `/v1/sessions/${deviceKey}/tick`, first);

  // Then try to regress.
  const regressed = makeSignedTick({
    deviceKey,
    sessionId,
    trigger: 'scheduled',
    cursorAfter: [{ providerId: 'claude-code', path: '/claude.jsonl', size: 1024, inode: 1 }],
    deltas: []
  });
  const regRes = await call('POST', `/v1/sessions/${deviceKey}/tick`, regressed);
  record('regressed cursor is rejected with 409', regRes.status === 409 && regRes.body?.error === 'cursor_regressed', `status=${regRes.status} error=${regRes.body?.error}`);

  await closeSession(deviceKey, sessionId);
}

// ────────────────────────────────────────────────────────────────────────
// Case 5: open + double-open → 409
// ────────────────────────────────────────────────────────────────────────
section('Case 5: open a second session while one is open → 409');

{
  const a = await call('POST', '/v1/sessions', {
    baselineCursors: [snapshot('/claude.jsonl', 'claude-code', 1024, 1)]
  });
  assert.equal(a.status, 200);
  const b = await call('POST', '/v1/sessions', {
    deviceKey: a.body.deviceKey,
    baselineCursors: []
  });
  record('second open with same deviceKey returns 409', b.status === 409, `status=${b.status}`);

  await closeSession(a.body.deviceKey, a.body.sessionId);
}

// ────────────────────────────────────────────────────────────────────────
// Case 6: tick after close → 409
// ────────────────────────────────────────────────────────────────────────
section('Case 6: tick after close → 409');

{
  const res = await call('POST', '/v1/sessions', {
    baselineCursors: [snapshot('/claude.jsonl', 'claude-code', 1024, 1)]
  });
  const { deviceKey, sessionId } = res.body;

  const closeRes = await closeSession(deviceKey, sessionId);
  record('close returns 200 before the bad tick', closeRes.status === 200, `status=${closeRes.status}`);

  const tick = makeSignedTick({
    deviceKey,
    sessionId,
    trigger: 'scheduled',
    cursorAfter: [{ providerId: 'claude-code', path: '/claude.jsonl', size: 2048, inode: 1 }],
    deltas: []
  });
  const tickRes = await call('POST', `/v1/sessions/${deviceKey}/tick`, tick);
  record('tick after close is rejected (409)', tickRes.status === 409, `status=${tickRes.status} error=${tickRes.body?.error}`);
}

// ────────────────────────────────────────────────────────────────────────
// Case 7: manual refresh rate-limit (案例 11)
// ────────────────────────────────────────────────────────────────────────
section('Case 7: manual refresh inside the 5s rate-limit window → 429');

{
  const res = await call('POST', '/v1/sessions', {
    baselineCursors: [snapshot('/claude.jsonl', 'claude-code', 1024, 1)]
  });
  const { deviceKey, sessionId } = res.body;

  const manual1 = makeSignedTick({
    deviceKey,
    sessionId,
    trigger: 'manual',
    cursorAfter: [{ providerId: 'claude-code', path: '/claude.jsonl', size: 2048, inode: 1 }],
    deltas: []
  });
  const r1 = await call('POST', `/v1/sessions/${deviceKey}/refresh`, manual1);
  record('first manual refresh returns 200', r1.status === 200, `status=${r1.status}`);

  const manual2 = makeSignedTick({
    deviceKey,
    sessionId,
    trigger: 'manual',
    cursorAfter: [{ providerId: 'claude-code', path: '/claude.jsonl', size: 2048, inode: 1 }],
    deltas: []
  });
  const r2 = await call('POST', `/v1/sessions/${deviceKey}/refresh`, manual2);
  const retryHeader = r2.raw.headers.get('retry-after');
  record('second manual refresh within 5s returns 429', r2.status === 429, `status=${r2.status}`);
  record('429 response carries Retry-After header', !!retryHeader, `retry-after=${retryHeader}`);
  record('429 response body has rate_limited reason', r2.body?.error === 'rate_limited', `error=${r2.body?.error}`);

  await closeSession(deviceKey, sessionId);
}

// ────────────────────────────────────────────────────────────────────────
// Case 8: GET /v1/sessions/:deviceKey reflects totals
// ────────────────────────────────────────────────────────────────────────
section('Case 8: GET /v1/sessions/:deviceKey reflects totalTokens');

{
  const res = await call('POST', '/v1/sessions', {
    baselineCursors: [snapshot('/claude.jsonl', 'claude-code', 1024, 1)]
  });
  const { deviceKey, sessionId } = res.body;

  const tick = makeSignedTick({
    deviceKey,
    sessionId,
    trigger: 'scheduled',
    cursorAfter: [{ providerId: 'claude-code', path: '/claude.jsonl', size: 4096, inode: 1 }],
    deltas: [makeDelta('claude-code', 'gpt-4', 5000)]
  });
  await call('POST', `/v1/sessions/${deviceKey}/tick`, tick);

  const getRes = await call('GET', `/v1/sessions/${deviceKey}`);
  record('GET returns 200 with openSession', getRes.status === 200, `status=${getRes.status}`);
  record('openSession.totalDeltas === 1', getRes.body?.openSession?.totalDeltas === 1, `totalDeltas=${getRes.body?.openSession?.totalDeltas}`);
  record('device.totalTokensAccepted >= 5000', getRes.body?.totalTokensAccepted >= 5000, `total=${getRes.body?.totalTokensAccepted}`);

  await closeSession(deviceKey, sessionId);
}

// ────────────────────────────────────────────────────────────────────────
// Summary
// ────────────────────────────────────────────────────────────────────────
await app.close();
rmSync(dataDir, { recursive: true, force: true });

const passed = results.filter((r) => r.pass).length;
const failed = results.length - passed;

console.log('');
console.log('\u001b[1m' + '='.repeat(56) + '\u001b[0m');
if (failed === 0) {
  console.log(`\u001b[1m\u001b[32m  SUCCESS — every session check passed.\u001b[0m`);
} else {
  console.log(`\u001b[1m\u001b[31m  FAILURES — ${failed} of ${results.length} checks did not pass.\u001b[0m`);
}
console.log(`  Total: ${results.length}  Passed: ${passed}  Failed: ${failed}`);
console.log('\u001b[1m' + '='.repeat(56) + '\u001b[0m');

if (failed > 0) {
  process.exit(1);
}

function snapshot(p: string, providerId: string, size: number, inode: number) {
  return { providerId, path: p, size, inode };
}
