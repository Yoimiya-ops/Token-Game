import { randomInt } from 'node:crypto';
import { DRAW_COST, LEGENDARY_PITY, RARE_PITY, RARITIES, WEAPONS, weaponById, type ForgeResult, type Rarity } from '@token-game/shared';
import type { CompanionSave } from './save';

export const secureRandom = () => randomInt(0, 1_000_000) / 1_000_000;
function randomValue(random: () => number) {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error('随机源不可用');
  return value;
}
function add(a: number, b: number) {
  const value = a + b;
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('数量超出可保存范围');
  return value;
}
export function drawWeapons(save: CompanionSave, count: number, random = secureRandom): ForgeResult {
  if (count !== 1 && count !== 10) throw new Error('只能单抽或十连');
  const cost = DRAW_COST * count;
  if (save.acknowledgedTokens - save.forge.spentTokens < cost) throw new Error('Token 不足，先收取盆中的积累');
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const roll = randomValue(random) * 100;
    let cumulative = 0;
    let tier: Rarity = 5;
    for (const rarity of RARITIES) {
      cumulative += rarity.chance;
      if (roll < cumulative) { tier = rarity.tier; break; }
    }
    if (save.forge.sinceLegendary >= LEGENDARY_PITY - 1) tier = 5;
    else if (save.forge.sinceRare >= RARE_PITY - 1 && tier < 3) tier = 3;
    const candidates = WEAPONS.filter(weapon => weapon.tier === tier);
    const weapon = candidates[Math.floor(randomValue(random) * candidates.length)]!;
    save.forge.inventory[weapon.id] = add(save.forge.inventory[weapon.id] ?? 0, 1);
    save.forge.sinceRare = tier >= 3 ? 0 : save.forge.sinceRare + 1;
    save.forge.sinceLegendary = tier === 5 ? 0 : save.forge.sinceLegendary + 1;
    ids.push(weapon.id);
  }
  save.forge.draws = add(save.forge.draws, count);
  save.forge.spentTokens = add(save.forge.spentTokens, cost);
  save.forge.lastDraw = ids;
  return { kind: 'draw', weaponIds: ids, quantity: count, shardsDelta: 0, tokensSpent: cost };
}
export function dismantleWeapon(save: CompanionSave, id: string, quantity: number): ForgeResult {
  const weapon = weaponById(id);
  if (!weapon || !Number.isSafeInteger(quantity) || quantity < 1) throw new Error('请选择有效的武器和数量');
  const owned = save.forge.inventory[id] ?? 0;
  if (quantity > owned) throw new Error('武器数量不足');
  const shards = RARITIES[weapon.tier - 1]!.salvage * quantity;
  save.forge.shards = add(save.forge.shards, shards);
  if (owned === quantity) delete save.forge.inventory[id];
  else save.forge.inventory[id] = owned - quantity;
  return { kind: 'dismantle', weaponIds: [id], quantity, shardsDelta: shards, tokensSpent: 0 };
}
export function exchangeWeapon(save: CompanionSave, id: string): ForgeResult {
  const weapon = weaponById(id);
  if (!weapon) throw new Error('这把武器不存在');
  const cost = RARITIES[weapon.tier - 1]!.exchange;
  if (save.forge.shards < cost) throw new Error('玄铁碎片不足');
  save.forge.shards -= cost;
  save.forge.inventory[id] = add(save.forge.inventory[id] ?? 0, 1);
  return { kind: 'exchange', weaponIds: [id], quantity: 1, shardsDelta: -cost, tokensSpent: 0 };
}

export function dismantleWeapons(save: CompanionSave, ids: unknown): ForgeResult {
  if (!Array.isArray(ids) || !ids.length || ids.length > WEAPONS.length ||
    ids.some(id => typeof id !== 'string' || !weaponById(id)) || new Set(ids).size !== ids.length) {
    throw new Error('请选择有效且不重复的武器');
  }
  let quantity = 0;
  let shards = 0;
  // Validate the entire selection before removing any inventory.
  for (const id of ids) {
    const owned = save.forge.inventory[id] ?? 0;
    if (!Number.isSafeInteger(owned) || owned < 1) throw new Error('所选武器数量已变化，请重新选择');
    quantity = add(quantity, owned);
    shards = add(shards, owned * RARITIES[weaponById(id)!.tier - 1]!.salvage);
  }
  const balance = add(save.forge.shards, shards);
  for (const id of ids) delete save.forge.inventory[id];
  save.forge.shards = balance;
  return { kind: 'dismantle', weaponIds: [...ids], quantity, shardsDelta: shards, tokensSpent: 0 };
}
