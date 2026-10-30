import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGameApp, resolveWebStaticRoot } from './index';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..', '..');

test('resolves the web build from repository and workspace directories', () => {
  assert.equal(resolveWebStaticRoot(repoRoot), path.join(repoRoot, 'apps', 'web', 'dist'));
  assert.equal(resolveWebStaticRoot(path.join(repoRoot, 'apps', 'server')), path.join(repoRoot, 'apps', 'web', 'dist'));
});
test('serves the receipt and provides only the companion API, with safe snapshot acknowledgement', async t => {
  const root = mkdtempSync(path.join(tmpdir(), 'companion-api-'));
  mkdirSync(path.join(root, 'sessions'));
  writeFileSync(path.join(root, 'index.html'), '<div id="root"></div>');
  let now = new Date('2026-10-29T01:00:00Z');
  const app = await createGameApp({ staticRoot: root, dataDir: path.join(root, 'data'), codexHome: root, startCollector: false, now: () => now });
  t.after(async () => { await app.close(); rmSync(root, { recursive: true, force: true }); });
  const page = await app.inject('/');
  assert.equal(page.statusCode, 200);
  assert.match(page.headers['content-type']!, /html/);
  assert.match(page.body, /id="root"/);
  assert.equal((await app.inject('/api/state')).json().totalTokens, 0);
  now = new Date('2026-10-29T02:00:00Z');
  const file = path.join(root, 'sessions', 'rollout-api.jsonl');
  writeFileSync(file, JSON.stringify({ type: 'session_meta', payload: { id: 'api-session' } }) + '\n');
  appendFileSync(file, JSON.stringify({ type: 'event_msg', timestamp: '2026-10-29T01:01:00Z', payload: { type: 'token_count', info: { total_token_usage: { total_tokens: 123 } } } }) + '\n');
  await app.companion.scan();
  const collect = await app.inject({ method: 'POST', url: '/api/collect', payload: { observedTotal: 123 } });
  assert.equal(collect.statusCode, 200);
  assert.equal(collect.json().collectedTokens, 123);
  assert.equal(collect.json().state.pendingTokens, 0);
  assert.equal((await app.inject({ method: 'POST', url: '/api/collect', payload: { observedTotal: 123 } })).json().collectedTokens, 0);
  for (const observedTotal of [124, -1, '123', null]) {
    assert.equal((await app.inject({ method: 'POST', url: '/api/collect', payload: { observedTotal } })).statusCode, 400);
  }
  for (const url of ['/api/actions/farm', '/api/actions/treasure-basin/condense', '/v1/sessions']) {
    assert.equal((await app.inject({ method: 'POST', url, payload: {} })).statusCode, 404);
  }
  const hostile = await app.inject({ method: 'POST', url: '/api/collect', headers: { origin: 'https://unrelated.example' }, payload: { observedTotal: 123 } });
  assert.equal(hostile.statusCode, 403);
  assert.equal((await app.inject({ method: 'POST', url: '/api/directory', payload: { directory: 'missing-relative-path' } })).statusCode, 400);
});
