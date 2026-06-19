export type CultivationPage = 'practice' | 'farm' | 'meditate' | 'alchemy';

export type CultivationState = {
  realm: string;
  realmLevel: number;
  qi: number;
  spiritStone: number;
  spiritHerb: number;
  pills: number;
  cultivation: number;
  currentPage: CultivationPage;
};

const realms = ['炼气一层', '炼气二层', '炼气三层', '筑基初期', '筑基中期', '筑基后期'];

function positiveInteger(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function normalizePage(value: unknown): CultivationPage {
  return value === 'farm' || value === 'meditate' || value === 'alchemy' ? value : 'practice';
}

export function realmNameForLevel(level: number) {
  return realms[Math.min(Math.max(0, Math.floor(level)), realms.length - 1)] ?? realms[0];
}

export function tokenEventToQi(tokenCount: number) {
  return Math.max(1, Math.floor(positiveInteger(tokenCount) / 100));
}

export function getPracticeCost(realmLevel: number) {
  return 12 * 2 ** Math.max(0, Math.floor(realmLevel));
}

export function getBreakthroughCost(realmLevel: number) {
  return 100 * 2 ** Math.max(0, Math.floor(realmLevel));
}

export function getAlchemyYield(spiritHerb: number, spiritStone: number) {
  return Math.min(positiveInteger(spiritHerb), positiveInteger(spiritStone));
}

export function normalizeCultivationState(value: Partial<CultivationState> | undefined): CultivationState {
  const realmLevel = positiveInteger(value?.realmLevel);
  return {
    realm: value?.realm ?? realmNameForLevel(realmLevel),
    realmLevel,
    qi: positiveInteger(value?.qi),
    spiritStone: positiveInteger(value?.spiritStone),
    spiritHerb: positiveInteger(value?.spiritHerb),
    pills: positiveInteger(value?.pills),
    cultivation: positiveInteger(value?.cultivation),
    currentPage: normalizePage(value?.currentPage)
  };
}
