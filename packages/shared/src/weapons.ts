export type Rarity = 1 | 2 | 3 | 4 | 5;
export type WeaponKind = 'sword' | 'saber' | 'spear';
export const DRAW_COST = 100_000;
export const RARE_PITY = 20;
export const LEGENDARY_PITY = 1000;
export const RARITIES = [
  { tier: 1, name: '凡品', chance: 75, salvage: 1, exchange: 12 },
  { tier: 2, name: '良品', chance: 20, salvage: 3, exchange: 36 },
  { tier: 3, name: '上品', chance: 4.5, salvage: 8, exchange: 120 },
  { tier: 4, name: '极品', chance: 0.4, salvage: 25, exchange: 400 },
  { tier: 5, name: '仙品', chance: 0.1, salvage: 100, exchange: 6000 }
] as const;
export type Weapon = { id: string; name: string; tier: Rarity; kind: WeaponKind };
const names = [
  ['青锋剑', '环首刀', '铁骨枪'],
  ['竹影剑', '赤练刀', '流云枪'],
  ['霜华剑', '惊雷刀', '照夜枪'],
  ['太虚剑', '焚天刀', '七曜枪'],
  ['诛仙剑', '开天刀', '定海枪']
];
export const WEAPONS: Weapon[] = names.flatMap((row, index) =>
  (['sword', 'saber', 'spear'] as const).map((kind, column) => ({
    id: 'w' + (index + 1) + '-' + kind, name: row[column]!, tier: (index + 1) as Rarity, kind
  }))
);
export function weaponById(id: string) { return WEAPONS.find(weapon => weapon.id === id); }
export type ForgeResult = {
  kind: 'draw' | 'dismantle' | 'exchange';
  weaponIds: string[];
  quantity: number;
  shardsDelta: number;
  tokensSpent: number;
};
export type ForgeRequest = { requestId: string; expectedRevision: number };
export type BatchDismantleRequest = ForgeRequest & { weaponIds: string[] };
export type ForgeState = {
  revision: number;
  balance: number;
  spentTokens: number;
  shards: number;
  inventory: Record<string, number>;
  draws: number;
  sinceRare: number;
  sinceLegendary: number;
  lastDraw: string[];
};
