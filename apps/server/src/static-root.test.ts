import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { resolveStaticRoot } from './index';

test('resolves the web dist directory when server starts from the server workspace', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'token-game-'));
  const webDist = path.join(root, 'apps', 'web', 'dist');
  const serverWorkspace = path.join(root, 'apps', 'server');

  mkdirSync(webDist, { recursive: true });
  mkdirSync(serverWorkspace, { recursive: true });
  writeFileSync(path.join(webDist, 'index.html'), '<main></main>');

  assert.equal(resolveStaticRoot(serverWorkspace), webDist);
});
