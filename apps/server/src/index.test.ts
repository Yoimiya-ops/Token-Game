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
