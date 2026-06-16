import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveWebStaticRoot } from './index';

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
