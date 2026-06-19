import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGameApp, resolveWebStaticRoot } from './index';

const repoRoot = path.resolve(fileURLToPath(import.meta.url), '..', '..', '..', '..');

test('resolves web static root from the repository root cwd', () => {
  assert.equal(
    resolveWebStaticRoot(repoRoot),
    path.join(repoRoot, 'apps', 'web', 'dist')
  );
});

test('resolves web static root from the server workspace cwd', () => {
  assert.equal(
    resolveWebStaticRoot(path.join(repoRoot, 'apps', 'server')),
    path.join(repoRoot, 'apps', 'web', 'dist')
  );
});

test('serves the built web app from the root route', async () => {
  const app = await createGameApp({
    tickIntervalMs: 60_000,
    tokenTrackerQueuePath: '/tmp/token-game-missing-queue.jsonl',
    runExternalTrackerSync: false
  });

  const response = await app.inject({ method: 'GET', url: '/' });

  assert.equal(response.statusCode, 200);
  assert.match(response.headers['content-type'] as string, /text\/html/);
  assert.match(response.body, /<div id="root"><\/div>/);

  await app.close();
});

test('serves the built web app from an explicit static root', async () => {
  const staticRoot = mkdtempSync(path.join(tmpdir(), 'token-game-static-'));
  mkdirSync(path.join(staticRoot, 'assets'), { recursive: true });
  writeFileSync(path.join(staticRoot, 'index.html'), '<!doctype html><div id="explicit-root"></div>');
  const app = await createGameApp({
    staticRoot,
    tickIntervalMs: 60_000,
    tokenTrackerQueuePath: '/tmp/token-game-missing-queue.jsonl',
    runExternalTrackerSync: false
  });

  try {
    const response = await app.inject({ method: 'GET', url: '/' });

    assert.equal(response.statusCode, 200);
    assert.match(response.body, /<div id="explicit-root"><\/div>/);
  } finally {
    await app.close();
    rmSync(staticRoot, { recursive: true, force: true });
  }
});

test('returns cultivation state and supports practice action errors', async () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'token-game-cultivation-api-'));
  process.env.TOKEN_GAME_DATA_DIR = dataDir;
  const app = await createGameApp({
    tickIntervalMs: 60_000,
    tokenTrackerQueuePath: '/tmp/token-game-missing-queue.jsonl',
    runExternalTrackerSync: false
  });

  try {
    const stateResponse = await app.inject({ method: 'GET', url: '/api/state' });
    const state = JSON.parse(stateResponse.body);

    assert.equal(stateResponse.statusCode, 200);
    assert.equal(state.player.realm, '炼气一层');
    assert.equal(typeof state.player.qi, 'number');

    const practiceResponse = await app.inject({ method: 'POST', url: '/api/actions/practice' });
    assert.equal(practiceResponse.statusCode, 400);
    assert.match(practiceResponse.body, /灵气不足/);
  } finally {
    await app.close();
    delete process.env.TOKEN_GAME_DATA_DIR;
    rmSync(dataDir, { recursive: true, force: true });
  }
});
