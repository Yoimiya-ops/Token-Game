import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getAlchemyYield,
  getPracticeCost,
  normalizeCultivationState,
  tokenEventToQi
} from '@token-game/shared';

test('converts token counts into qi', () => {
  assert.equal(tokenEventToQi(1000), 10);
  assert.equal(tokenEventToQi(9), 1);
});

test('calculates practice cost by realm level', () => {
  assert.equal(getPracticeCost(0), 12);
  assert.equal(getPracticeCost(2), 48);
});

test('calculates alchemy yield from available materials', () => {
  assert.equal(getAlchemyYield(3, 5), 3);
  assert.equal(getAlchemyYield(7, 2), 2);
});

test('normalizes missing cultivation state', () => {
  assert.deepEqual(normalizeCultivationState(undefined), {
    realm: '炼气一层',
    realmLevel: 0,
    qi: 0,
    spiritStone: 0,
    spiritHerb: 0,
    pills: 0,
    cultivation: 0,
    currentPage: 'practice'
  });
});
