import assert from 'node:assert/strict';
import { test } from 'node:test';
import { paintSelection, strokeIntersects } from './weapon-selection';

const bounds = { left: 10, top: 10, right: 20, bottom: 20 };
test('drag strokes hit every crossed card even when pointer events skip the card', () => {
  for (const [start, end] of [
    [{ x: 0, y: 15 }, { x: 30, y: 15 }],
    [{ x: 15, y: 30 }, { x: 15, y: 0 }],
    [{ x: 0, y: 0 }, { x: 30, y: 30 }],
    [{ x: 15, y: 15 }, { x: 15, y: 15 }]
  ]) assert.equal(strokeIntersects(start!, end!, bounds), true);
});
test('drag strokes outside a card and in grid gutters do not select it', () => {
  assert.equal(strokeIntersects({ x: 0, y: 9 }, { x: 30, y: 9 }, bounds), false);
  assert.equal(strokeIntersects({ x: 21, y: 0 }, { x: 21, y: 30 }, bounds), false);
  assert.equal(strokeIntersects({ x: 0, y: 0 }, { x: 5, y: 5 }, bounds), false);
});
test('paint selection adds or removes without toggling repeatedly crossed cards', () => {
  const original = ['one', 'two'];
  assert.deepEqual(paintSelection(original, ['two', 'three', 'three'], true), ['one', 'two', 'three']);
  assert.deepEqual(paintSelection(original, ['two', 'three'], false), ['one']);
  assert.deepEqual(original, ['one', 'two']);
});
