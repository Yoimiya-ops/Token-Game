const assert = require('node:assert/strict');
const test = require('node:test');
const { resolvePetViewState } = require('./pet-view.cjs');

test('maps css assets to the default cat view', () => {
  assert.deepEqual(resolvePetViewState({ kind: 'css', id: 'default-cat' }), {
    bodyKind: 'css',
    activeAssetId: 'default-cat',
    imageSrc: ''
  });
});

test('maps image assets to image view state', () => {
  assert.deepEqual(resolvePetViewState({ kind: 'image', id: 'red-swords', src: './assets/processed/red-swords.png' }), {
    bodyKind: 'image',
    activeAssetId: 'red-swords',
    imageSrc: './assets/processed/red-swords.png'
  });
});
