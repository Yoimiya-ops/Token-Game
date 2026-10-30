import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { DRAW_COST, LEGENDARY_PITY, RARE_PITY, RARITIES, WEAPONS, weaponById, type ForgeRequest } from '@token-game/shared';
import { CodexCollector } from './collector';
import { SaveStore, type CompanionSave } from './save';
import { dismantleWeapons, drawWeapons } from './forge';

function setup(t: { after: (fn: () => unknown) => void }, random: () => number = () => 0, edit?: (save: CompanionSave) => void) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'basin-forge-'));
  const store = new SaveStore(root);
  const initial = store.load(root, new Date());
  initial.totalTokens = 10_000_000;
  initial.acknowledgedTokens = 10_000_000;
  edit?.(initial);
  store.commit(initial);
  const options = { dataDir: root, codexHome: root, random };
  const collector = new CodexCollector(options);
  t.after(async () => { await collector.close(); rmSync(root, { recursive: true, force: true }); });
  let sequence = 0;
  const request = (): ForgeRequest => ({ requestId: 'request-' + ++sequence, expectedRevision: collector.state().forge.revision });
  return { root, initial, collector, options, request };
}

test('base rarity thresholds match the published rates and all 15 weapons are reachable', t => {
  const s = setup(t);
  const cases = [[0,1], [.749999,1], [.75,2], [.949999,2], [.95,3], [.994999,3], [.995,4], [.998999,4], [.999,5], [.999999,5]];
  for (const [roll, tier] of cases) {
    const save = structuredClone(s.initial);
    let call = 0;
    const result = drawWeapons(save, 1, () => call++ % 2 === 0 ? roll! : 0);
    assert.equal(weaponById(result.weaponIds[0]!)?.tier, tier);
  }
  const reached = new Set<string>();
  for (const roll of [.1, .8, .97, .998, .9995]) for (const index of [0, .4, .8]) {
    let call = 0;
    reached.add(drawWeapons(structuredClone(s.initial), 1, () => call++ % 2 === 0 ? roll : index).weaponIds[0]!);
  }
  assert.equal(reached.size, WEAPONS.length);
});

test('twenty draws guarantee rare, one thousand guarantee legendary, and counters persist', async t => {
  const s = setup(t);
  const save = structuredClone(s.initial);
  save.acknowledgedTokens = save.totalTokens = (LEGENDARY_PITY + 10) * DRAW_COST;
  for (let i = 0; i < LEGENDARY_PITY - 1; i++) {
    drawWeapons(save, 1, () => 0);
    assert.ok(save.forge.sinceRare < RARE_PITY);
  }
  s.collector.store.commit(save);
  const reopened = new CodexCollector(s.options);
  assert.equal(reopened.state().forge.sinceLegendary, LEGENDARY_PITY - 1);
  assert.equal(reopened.state().forge.sinceRare, RARE_PITY - 1);
  const { state: { forge: state } } = await reopened.draw({ requestId: 'pity-last-draw', expectedRevision: 0, count: 1 });
  assert.equal(state.draws, LEGENDARY_PITY);
  assert.equal(state.sinceLegendary, 0);
  assert.equal(state.sinceRare, 0);
  assert.equal(state.inventory['w5-sword'], 1);
  assert.equal(state.inventory['w3-sword'], LEGENDARY_PITY / RARE_PITY - 1);
  assert.equal(state.balance, 10 * DRAW_COST);
  await reopened.close();
});

test('naturally rolled higher tiers reset the corresponding counters', t => {
  const s = setup(t);
  const save = structuredClone(s.initial);
  save.forge.sinceRare = 8; save.forge.sinceLegendary = 20;
  drawWeapons(save, 1, () => .998);
  assert.equal(save.forge.sinceRare, 0);
  assert.equal(save.forge.sinceLegendary, 21);
  drawWeapons(save, 1, () => .9995);
  assert.equal(save.forge.sinceLegendary, 0);
  assert.equal(save.forge.sinceRare, 0);
});

test('uncollected tokens cannot be spent and claiming never duplicates the balance', async t => {
  const s = setup(t, undefined, save => { save.acknowledgedTokens = 0; });
  await assert.rejects(s.collector.draw({ ...s.request(), count: 1 }), /Token 不足/);
  await s.collector.acknowledge(DRAW_COST);
  await s.collector.acknowledge(DRAW_COST);
  assert.equal(s.collector.state().forge.balance, DRAW_COST);
  await s.collector.draw({ ...s.request(), count: 1 });
  assert.equal(s.collector.state().forge.balance, 0);
  assert.equal(s.collector.state().totalTokens, 10_000_000);
  assert.equal(s.collector.state().pendingTokens, 10_000_000 - DRAW_COST);
});

test('concurrent duplicate requests and retries after restart cannot charge twice', async t => {
  const s = setup(t);
  const request = { ...s.request(), count: 10 };
  const [a, b] = await Promise.all([s.collector.draw(request), s.collector.draw(request)]);
  assert.deepEqual(a.result, b.result);
  assert.equal(s.collector.state().forge.spentTokens, DRAW_COST * 10);
  await assert.rejects(s.collector.draw({ ...request, count: 1 }), /内容不一致/);
  const reopened = new CodexCollector(s.options);
  assert.deepEqual((await reopened.draw(request)).result, a.result);
  assert.equal(reopened.state().forge.spentTokens, DRAW_COST * 10);
  await reopened.close();
});

test('stale concurrent actions cannot mutate newer inventory or balance', async t => {
  const s = setup(t);
  const revision = s.collector.state().forge.revision;
  const results = await Promise.allSettled([
    s.collector.draw({ requestId: 'parallel-one', expectedRevision: revision, count: 1 }),
    s.collector.draw({ requestId: 'parallel-two', expectedRevision: revision, count: 1 })
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(s.collector.state().forge.draws, 1);
});

test('dismantling and targeted exchange are atomic and cannot create an arbitrage loop', async t => {
  const s = setup(t, undefined, save => { save.forge.inventory['w1-sword'] = 12; });
  const broken = await s.collector.dismantle({ ...s.request(), weaponId: 'w1-sword', quantity: 12 });
  assert.equal(broken.result.shardsDelta, 12);
  assert.equal(broken.state.forge.inventory['w1-sword'], undefined);
  const exchanged = await s.collector.exchange({ ...s.request(), weaponId: 'w1-saber' });
  assert.equal(exchanged.state.forge.shards, 0);
  assert.equal(exchanged.state.forge.inventory['w1-saber'], 1);
  assert.equal(exchanged.state.forge.sinceLegendary, 0);
  await s.collector.dismantle({ ...s.request(), weaponId: 'w1-saber', quantity: 1 });
  assert.equal(s.collector.state().forge.shards, 1);
  for (const rarity of RARITIES) assert.ok(rarity.exchange > rarity.salvage);
});

test('invalid quantities, insufficient materials and unknown weapons leave the save untouched', async t => {
  const s = setup(t, undefined, save => { save.forge.inventory['w1-sword'] = 2; });
  const before = s.collector.state().forge;
  for (const quantity of [0, -1, 1.5, 3, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
    await assert.rejects(s.collector.dismantle({ ...s.request(), weaponId: 'w1-sword', quantity }));
  }
  await assert.rejects(s.collector.dismantle({ ...s.request(), weaponId: 'missing', quantity: 1 }));
  await assert.rejects(s.collector.exchange({ ...s.request(), weaponId: 'w5-sword' }));
  await assert.rejects(s.collector.draw({ ...s.request(), count: 100 }));
  assert.deepEqual(s.collector.state().forge, before);
});

test('disk failure and invalid randomness never partially charge or award', async t => {
  let calls = 0;
  const s = setup(t, () => ++calls === 4 ? NaN : 0);
  const before = s.collector.state().forge;
  await assert.rejects(s.collector.draw({ ...s.request(), count: 10 }), /随机源/);
  assert.deepEqual(s.collector.state().forge, before);
  const commit = s.collector.store.commit.bind(s.collector.store);
  s.collector.store.commit = () => { throw new Error('disk full'); };
  await assert.rejects(s.collector.draw({ ...s.request(), count: 1 }), /disk full/);
  assert.deepEqual(s.collector.state().forge, before);
  s.collector.store.commit = commit;
});

test('v1 migration backs up the original and credits only previously acknowledged tokens once', async t => {
  const s = setup(t);
  const old = { ...s.initial, schemaVersion: 1, acknowledgedTokens: DRAW_COST + 2345, legacyTokens: 999999 } as Record<string, unknown>;
  delete old.forge;
  writeFileSync(s.collector.store.file, JSON.stringify(old));
  const migrated = new CodexCollector(s.options);
  assert.equal(migrated.state().forge.balance, DRAW_COST + 2345);
  assert.ok(existsSync(migrated.store.file + '.pre-weapons.bak'));
  assert.equal(JSON.parse(readFileSync(migrated.store.file, 'utf8')).schemaVersion, 2);
  await migrated.draw({ requestId: 'migration-draw', expectedRevision: 0, count: 1 });
  await migrated.close();
  const restarted = new CodexCollector(s.options);
  assert.equal(restarted.state().forge.balance, 2345);
  assert.equal(restarted.state().legacyTokens, 999999);
  await restarted.close();
});

test('seeded long-run economy preserves rarity ordering and bounded pity gaps', t => {
  const s = setup(t);
  const save = structuredClone(s.initial);
  save.acknowledgedTokens = save.totalTokens = Number.MAX_SAFE_INTEGER;
  let seed = 123456789;
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
  const counts = [0, 0, 0, 0, 0];
  let maxRare = 0, maxLegendary = 0;
  const draws = 5_000_000;
  for (let i = 0; i < draws; i++) {
    const result = drawWeapons(save, 1, random);
    counts[weaponById(result.weaponIds[0]!)!.tier - 1]++;
    maxRare = Math.max(maxRare, save.forge.sinceRare);
    maxLegendary = Math.max(maxLegendary, save.forge.sinceLegendary);
  }
  for (let i = 1; i < counts.length; i++) assert.ok(counts[i - 1]! > counts[i]!);
  assert.ok(maxRare < RARE_PITY && maxLegendary < LEGENDARY_PITY);
  assert.ok(counts[4]! / draws > .0015 && counts[4]! / draws < .0017);
  // Keep every legendary, dismantle all other tiers, and spend shards only on legendary exchanges.
  const shards = counts.slice(0, 4).reduce((sum, count, i) => sum + count * RARITIES[i]!.salvage, 0);
  const redeemed = Math.floor(shards / RARITIES[4].exchange);
  const tokensPerLegendary = draws * DRAW_COST / (counts[4]! + redeemed);
  const days = [5_000_000, 7_500_000, 10_000_000].map(daily => tokensPerLegendary / daily);
  assert.ok(days[1]! > 6.8 && days[1]! < 7.2, 'Combined draw + salvage economy should average one legendary per week at 7.5M tokens/day');
  console.log('Economy simulation:', JSON.stringify({ draws, counts, rates: counts.map(n => +(n / draws * 100).toFixed(4)), redeemed, averageNonLegendaryShards: shards / draws, meanLegendaryDraws: draws / counts[4]!, tokensPerLegendary, days }));
});

test('batch dismantle removes every copy of selected weapons in one replay-safe transaction', async t => {
  const s = setup(t, undefined, save => {
    for (const weapon of WEAPONS) save.forge.inventory[weapon.id] = weapon.tier + 1;
    save.forge.shards = 7;
  });
  const ids = WEAPONS.map(w => w.id);
  const request = { ...s.request(), weaponIds: ids };
  const quantity = WEAPONS.reduce((sum, w) => sum + w.tier + 1, 0);
  const shards = WEAPONS.reduce((sum, w) => sum + (w.tier + 1) * RARITIES[w.tier - 1]!.salvage, 0);
  const [a, b] = await Promise.all([s.collector.dismantleBatch(request), s.collector.dismantleBatch({ ...request, weaponIds: [...ids].reverse() })]);
  assert.deepEqual(a.result, b.result);
  assert.equal(a.result.quantity, quantity);
  assert.equal(a.result.shardsDelta, shards);
  assert.equal(a.result.weaponIds.length, 15);
  assert.deepEqual(a.state.forge.inventory, {});
  assert.equal(a.state.forge.shards, 7 + shards);
  assert.equal(a.state.forge.revision, 1);
  assert.equal(a.state.forge.spentTokens, 0);
  const reopened = new CodexCollector(s.options);
  assert.deepEqual((await reopened.dismantleBatch(request)).result, a.result);
  assert.deepEqual(reopened.state().forge, a.state.forge);
  await reopened.close();
});

test('batch validation, stale snapshots and disk errors never partially dismantle inventory', async t => {
  const s = setup(t, undefined, save => { save.forge.inventory = { 'w1-sword': 4, 'w2-saber': 3, 'w5-sword': 1 }; });
  const before = s.collector.state().forge;
  for (const weaponIds of [[], ['w1-sword', 'missing'], ['w1-sword', 'w1-sword'], ['w1-sword', 'w3-sword'], [null], 'w1-sword', null]) {
    await assert.rejects(s.collector.dismantleBatch({ ...s.request(), weaponIds: weaponIds as string[] }));
    assert.deepEqual(s.collector.state().forge, before);
  }
  const request = { ...s.request(), weaponIds: ['w1-sword', 'w2-saber'] };
  const commit = s.collector.store.commit.bind(s.collector.store);
  s.collector.store.commit = () => { throw new Error('disk full'); };
  await assert.rejects(s.collector.dismantleBatch(request), /disk full/);
  assert.deepEqual(s.collector.state().forge, before);
  s.collector.store.commit = commit;
  const result = await s.collector.dismantleBatch(request);
  assert.deepEqual(result.state.forge.inventory, { 'w5-sword': 1 });
  assert.equal(result.result.quantity, 7);
  assert.equal(result.result.shardsDelta, 13);
  await assert.rejects(s.collector.dismantleBatch({ ...request, requestId: 'stale-batch', weaponIds: ['w5-sword'] }), /进度已更新/);
  await assert.rejects(s.collector.dismantleBatch({ ...request, weaponIds: ['w5-sword'] }), /内容不一致/);
  const overflow = structuredClone(s.initial);
  overflow.forge.inventory = { 'w1-sword': 1, 'w5-sword': Number.MAX_SAFE_INTEGER };
  const copy = structuredClone(overflow);
  assert.throws(() => dismantleWeapons(overflow, ['w1-sword', 'w5-sword']), /范围/);
  assert.deepEqual(overflow, copy);
});

test('existing v2 inventory, shards, balance and pity counts survive the economy update', async t => {
  const s = setup(t, undefined, save => {
    save.forge = { ...save.forge, draws: 49, spentTokens: 490_000, sinceRare: 9, sinceLegendary: 49, shards: 1600, inventory: { 'w5-sword': 2 } };
  });
  const reopened = new CodexCollector(s.options);
  assert.deepEqual(reopened.state().forge, s.collector.state().forge);
  const drawn = await reopened.draw({ requestId: 'new-price-draw', expectedRevision: 0, count: 1 });
  assert.equal(drawn.state.forge.balance, 10_000_000 - 490_000 - DRAW_COST);
  assert.equal(drawn.state.forge.sinceLegendary, 50);
  assert.equal(drawn.state.forge.shards, 1600);
  assert.equal(drawn.state.forge.inventory['w5-sword'], 2);
  await reopened.close();
});
