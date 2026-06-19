import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCultivationLedger,
  farmOnce,
  meditateOnce,
  practiceOnce,
  runAlchemy
} from './store';

test('creates a cultivation ledger with default resources', () => {
  const ledger = createCultivationLedger();

  assert.equal(ledger.player.realm, '炼气一层');
  assert.equal(ledger.player.qi, 0);
  assert.equal(ledger.player.spiritHerb, 0);
  assert.equal(ledger.player.pills, 0);
});

test('practice consumes qi and adds cultivation', () => {
  const ledger = createCultivationLedger();
  ledger.player.qi = 20;

  assert.equal(practiceOnce(ledger), true);
  assert.equal(ledger.player.qi, 8);
  assert.equal(ledger.player.cultivation, 18);
});

test('farm grows spirit herbs and stones', () => {
  const ledger = createCultivationLedger();

  assert.equal(farmOnce(ledger), true);
  assert.equal(ledger.player.spiritHerb, 3);
  assert.equal(ledger.player.spiritStone, 2);
});

test('meditation adds stable qi and cultivation', () => {
  const ledger = createCultivationLedger();

  assert.equal(meditateOnce(ledger), true);
  assert.equal(ledger.player.qi, 6);
  assert.equal(ledger.player.cultivation, 4);
});

test('alchemy consumes herb and stone to make pills', () => {
  const ledger = createCultivationLedger();
  ledger.player.spiritHerb = 4;
  ledger.player.spiritStone = 3;

  assert.equal(runAlchemy(ledger), true);
  assert.equal(ledger.player.spiritHerb, 1);
  assert.equal(ledger.player.spiritStone, 0);
  assert.equal(ledger.player.pills, 3);
});

test('alchemy fails when materials are missing', () => {
  const ledger = createCultivationLedger();

  assert.equal(runAlchemy(ledger), false);
  assert.equal(ledger.player.pills, 0);
});
