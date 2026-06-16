import assert from 'node:assert/strict';
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
  const app = await createGameApp({ tickIntervalMs: 60_000 });

  const response = await app.inject({ method: 'GET', url: '/' });

  assert.equal(response.statusCode, 200);
  assert.match(response.headers['content-type'] as string, /text\/html/);
  assert.match(response.body, /<div id="root"><\/div>/);

  await app.close();
});
