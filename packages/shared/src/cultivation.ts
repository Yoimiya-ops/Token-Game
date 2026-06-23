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

const qiCondensationStages = ['一层', '二层', '三层'];
const majorRealms = ['筑基', '金丹', '元婴', '化神', '炼虚', '合体', '大乘', '渡劫'];
const minorStages = ['初期', '中期', '后期'];

function positiveInteger(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function normalizePage(value: unknown): CultivationPage {
  return value === 'farm' || value === 'meditate' || value === 'alchemy' ? value : 'practice';
}

export function realmNameForLevel(level: number) {
  const normalizedLevel = Math.max(0, Math.floor(level));
  if (normalizedLevel < qiCondensationStages.length) {
    return `炼气${qiCondensationStages[normalizedLevel]}`;
  }

  const realmIndex = Math.floor((normalizedLevel - qiCondensationStages.length) / minorStages.length);
  const stage = minorStages[(normalizedLevel - qiCondensationStages.length) % minorStages.length] ?? minorStages[0];
  const realm = majorRealms[Math.min(realmIndex, majorRealms.length - 1)] ?? majorRealms[0];
  return `${realm}${stage}`;
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
    realm: realmNameForLevel(realmLevel),
    realmLevel,
    qi: positiveInteger(value?.qi),
    spiritStone: positiveInteger(value?.spiritStone),
    spiritHerb: positiveInteger(value?.spiritHerb),
    pills: positiveInteger(value?.pills),
    cultivation: positiveInteger(value?.cultivation),
    currentPage: normalizePage(value?.currentPage)
  };
}
