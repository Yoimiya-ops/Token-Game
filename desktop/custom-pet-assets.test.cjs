const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  deleteCustomPetAsset,
  importCustomPetAsset,
  listCustomPetAssets,
  renameCustomPetAsset
} = require('./custom-pet-assets.cjs');

test('imports a still image pet asset into user data', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'token-game-custom-pet-'));
  const source = path.join(dir, 'Cute Pet.png');
  writeFileSync(source, 'fake-png');

  const asset = importCustomPetAsset(dir, source, '我的桌宠');

  assert.equal(asset.label, '我的桌宠');
  assert.equal(asset.kind, 'image');
  assert.equal(asset.custom, true);
  assert.match(asset.id, /^custom-/);
  assert.match(asset.src, /custom-pets\/custom-.*\.png$/);
  assert.deepEqual(listCustomPetAssets(dir), [asset]);

  rmSync(dir, { recursive: true, force: true });
});

test('imports animated image formats without changing their extension', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'token-game-custom-pet-'));
  const source = path.join(dir, 'Run.webp');
  writeFileSync(source, 'fake-webp-animation');

  const asset = importCustomPetAsset(dir, source);

  assert.equal(asset.label, 'Run');
  assert.match(asset.src, /\.webp$/);

  rmSync(dir, { recursive: true, force: true });
});

test('renames an imported custom pet asset', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'token-game-custom-pet-'));
  const source = path.join(dir, 'Cute Pet.gif');
  writeFileSync(source, 'fake-gif');
  const asset = importCustomPetAsset(dir, source, '旧名字');

  const renamed = renameCustomPetAsset(dir, asset.id, '新名字');

  assert.equal(renamed?.label, '新名字');
  assert.equal(listCustomPetAssets(dir)[0].label, '新名字');

  rmSync(dir, { recursive: true, force: true });
});

test('deletes an imported custom pet asset and its copied file', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'token-game-custom-pet-'));
  const source = path.join(dir, 'Cute Pet.gif');
  writeFileSync(source, 'fake-gif');
  const asset = importCustomPetAsset(dir, source, '要删除的桌宠');
  const copiedPath = decodeURIComponent(asset.src.replace('file://', ''));

  const deleted = deleteCustomPetAsset(dir, asset.id);

  assert.equal(deleted?.id, asset.id);
  assert.deepEqual(listCustomPetAssets(dir), []);
  assert.throws(() => readFileSync(copiedPath), /ENOENT/);

  rmSync(dir, { recursive: true, force: true });
});

test('returns undefined when deleting a missing custom pet asset', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'token-game-custom-pet-'));

  assert.equal(deleteCustomPetAsset(dir, 'custom-missing'), undefined);

  rmSync(dir, { recursive: true, force: true });
});

test('rejects unsupported pet asset files', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'token-game-custom-pet-'));
  const source = path.join(dir, 'note.txt');
  writeFileSync(source, 'nope');

  assert.throws(() => importCustomPetAsset(dir, source), /Unsupported pet image/);

  rmSync(dir, { recursive: true, force: true });
});

test('keeps custom asset metadata readable when JSON is malformed', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'token-game-custom-pet-'));
  writeFileSync(path.join(dir, 'custom-pets.json'), '{broken');

  assert.deepEqual(listCustomPetAssets(dir), []);
  assert.equal(readFileSync(path.join(dir, 'custom-pets.json'), 'utf8'), '{broken');

  rmSync(dir, { recursive: true, force: true });
});
