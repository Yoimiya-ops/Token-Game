import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advanceHomestead,
  breakthroughOnce,
  condenseTreasure,
  createCultivationLedger,
  dispatchSpiritBeast,
  farmOnce,
  meditateOnce,
  practiceOnce,
  rollDivination,
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

test('breakthrough advances past Foundation Establishment into Golden Core', () => {
  const ledger = createCultivationLedger();
  ledger.player.realm = '筑基后期';
  ledger.player.realmLevel = 5;
  ledger.player.cultivation = 3200;
  ledger.player.pills = 1;

  assert.equal(breakthroughOnce(ledger), true);
  assert.equal(ledger.player.realmLevel, 6);
  assert.equal(ledger.player.realm, '金丹初期');
  assert.equal(ledger.player.pills, 0);
});

test('rolls divination into homestead state and records a log', () => {
  const ledger = createCultivationLedger();

  const omen = rollDivination(ledger, new Date('2026-06-22T00:00:00.000Z'));

  assert.equal(omen.fortune, '小吉');
  assert.deepEqual(omen.favors, ['炼丹', '蕴养', '闭关']);
  assert.equal(ledger.homestead.omen?.fortune, '小吉');
  assert.match(ledger.homestead.logs[0].title, /今日卦象/);
});

test('treasure basin consumes kindling and creates loot', () => {
  const ledger = createCultivationLedger();
  ledger.player.kindling = 2;

  const result = condenseTreasure(ledger, new Date('2026-06-22T01:00:00.000Z'));

  assert.equal(result?.name, '百年灵芝');
  assert.equal(ledger.player.kindling, 1);
  assert.equal(ledger.homestead.treasureBasin.dailyCondenses, 1);
  assert.equal(ledger.homestead.inventory[0].name, '百年灵芝');
});

test('spirit beast expedition completes during homestead advancement', () => {
  const ledger = createCultivationLedger();
  ledger.player.spiritStone = 5;

  assert.equal(dispatchSpiritBeast(ledger, new Date('2026-06-22T02:00:00.000Z')), true);
  assert.equal(ledger.homestead.spiritBeast.status, 'traveling');

  advanceHomestead(ledger, new Date('2026-06-22T02:31:00.000Z'));

  assert.equal(ledger.homestead.spiritBeast.status, 'idle');
  assert.equal(ledger.player.spiritHerb, 2);
  assert.match(ledger.homestead.logs[0].title, /灵兽归山/);
});
