const assert = require('node:assert/strict');
const test = require('node:test');
const {
  defaultPetAssetId,
  getPetAssetById,
  listPetAssets,
  normalizePetAssetId
} = require('./pet-assets.cjs');

test('lists the built-in and imported pet assets', () => {
  const assets = listPetAssets();

  assert.deepEqual(
    assets.map((asset) => asset.id),
    ['default-cat', 'red-swords', 'pink-sword']
  );
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
