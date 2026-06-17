const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  deletePetAsset,
  defaultPetAssetId,
  getPetAssetById,
  listPetAssets,
  normalizePetAssetId,
  renamePetAsset
} = require('./pet-assets.cjs');

test('lists the built-in and imported pet assets', () => {
  const assets = listPetAssets();

  assert.deepEqual(
    assets.map((asset) => asset.id),
    ['default-cat', 'red-swords', 'pink-sword', 'pink-white-dress']
  );
  assert.deepEqual(assets[0], {
    id: 'default-cat',
    label: '默认小猫',
    kind: 'image',
    src: './assets/processed/default-cat.webp'
  });
});

test('normalizes unknown pet asset ids to the default asset', () => {
  assert.equal(normalizePetAssetId('red-swords'), 'red-swords');
  assert.equal(normalizePetAssetId('missing'), defaultPetAssetId);
  assert.equal(normalizePetAssetId(undefined), defaultPetAssetId);
});

test('returns asset metadata by id', () => {
  const asset = getPetAssetById('pink-sword');

  assert.equal(asset.label, '粉发大剑角色');
  assert.equal(asset.kind, 'image');
  assert.equal(asset.src, './assets/processed/pink-sword.png');
});

test('returns animated pet asset metadata by id', () => {
  const asset = getPetAssetById('pink-white-dress');

  assert.equal(asset.label, '粉发白裙角色');
  assert.equal(asset.kind, 'image');
  assert.equal(asset.src, './assets/processed/pink-white-dress.webp');
});

test('deletes a built-in image pet asset by hiding it from user data lists', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'token-game-pet-assets-'));

  const deleted = deletePetAsset(dir, 'pink-sword');

  assert.equal(deleted?.id, 'pink-sword');
  assert.deepEqual(
    listPetAssets(dir).map((asset) => asset.id),
    ['default-cat', 'red-swords', 'pink-white-dress']
  );
  assert.equal(getPetAssetById('pink-sword', dir).id, defaultPetAssetId);
  assert.equal(normalizePetAssetId('pink-sword', dir), defaultPetAssetId);

  rmSync(dir, { recursive: true, force: true });
});

test('keeps the default pet asset available when delete is requested', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'token-game-pet-assets-'));

  assert.equal(deletePetAsset(dir, defaultPetAssetId), undefined);
  assert.equal(getPetAssetById(defaultPetAssetId, dir).id, defaultPetAssetId);

  rmSync(dir, { recursive: true, force: true });
});

test('renames a built-in image pet asset using user data overrides', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'token-game-pet-assets-'));

  const renamed = renamePetAsset(dir, 'pink-white-dress', '白裙猫娘');

  assert.equal(renamed?.label, '白裙猫娘');
  assert.equal(getPetAssetById('pink-white-dress', dir).label, '白裙猫娘');
  assert.equal(listPetAssets(dir).find((asset) => asset.id === 'pink-white-dress')?.label, '白裙猫娘');

  rmSync(dir, { recursive: true, force: true });
});

test('renames the default built-in image pet while keeping it as fallback', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'token-game-pet-assets-'));

  const renamed = renamePetAsset(dir, defaultPetAssetId, '白色小猫');

  assert.equal(renamed?.label, '白色小猫');
  assert.equal(getPetAssetById(defaultPetAssetId, dir).label, '白色小猫');

  rmSync(dir, { recursive: true, force: true });
});
