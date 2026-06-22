import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  getAlchemyYield,
  getPracticeCost,
  normalizeCultivationState,
  realmNameForLevel,
  type CultivationState,
  type TokenEvent
} from '@token-game/shared';

export type StoredEvent = TokenEvent & {
  qiGained: number;
  foodGained?: number;
};

export type TrackerState = {
  bucketTokens: Record<string, number>;
  lastSyncedAt: string | null;
};

export type PlayerState = CultivationState & {
  kittenName: string;
  totalTokens: number;
  lastFedAt: string | null;
  kindling: number;
};

export type HomesteadLog = {
  id: string;
  type: 'omen' | 'treasure' | 'beast';
  title: string;
  body: string;
  occurredAt: string;
};

export type OmenState = {
  fortune: '大吉' | '小吉' | '平' | '小凶';
  favors: string[];
  verse: string;
  rolledAt: string;
};

export type InventoryItem = {
  id: string;
  name: string;
  kind: 'herb' | 'stone' | 'pill' | 'curio';
  quantity: number;
  createdAt: string;
  description: string;
};

export type TreasureBasinState = {
  dayKey: string | null;
  dailyCondenses: number;
  lastCondensedAt: string | null;
};

export type SpiritBeastState = {
  name: string;
  status: 'idle' | 'traveling';
  route: string | null;
  lastDispatchedAt: string | null;
  returnsAt: string | null;
};

export type HomesteadState = {
  omen: OmenState | null;
  treasureBasin: TreasureBasinState;
  spiritBeast: SpiritBeastState;
  inventory: InventoryItem[];
  logs: HomesteadLog[];
};

export type Ledger = {
  player: PlayerState;
  events: StoredEvent[];
  trackerState: TrackerState;
  homestead: HomesteadState;
};

const initialLedger: Ledger = {
  player: {
    kittenName: 'Mochi',
    ...normalizeCultivationState(undefined),
    totalTokens: 0,
    lastFedAt: null,
    kindling: 0
  },
  events: [],
  trackerState: {
    bucketTokens: {},
    lastSyncedAt: null
  },
  homestead: {
    omen: null,
    treasureBasin: {
      dayKey: null,
      dailyCondenses: 0,
      lastCondensedAt: null
    },
    spiritBeast: {
      name: '青霜',
      status: 'idle',
      route: null,
      lastDispatchedAt: null,
      returnsAt: null
    },
    inventory: [],
    logs: []
  }
};

function positiveInteger(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function createId(prefix: string, now: Date) {
  return `${prefix}:${now.toISOString().replaceAll(':', '-')}`;
}

function dayKeyFor(now: Date) {
  return now.toISOString().slice(0, 10);
}

function hashDate(now: Date, salt: number) {
  const key = `${now.toISOString()}|${salt}`;
  let hash = 0;
  for (const char of key) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash;
}

function pickByDate<T>(items: T[], now: Date, salt: number) {
  return items[hashDate(now, salt) % items.length] as T;
}

function prependLog(ledger: Ledger, log: HomesteadLog) {
  ledger.homestead.logs.unshift(log);
  ledger.homestead.logs = ledger.homestead.logs.slice(0, 24);
}

function normalizeOmen(value: unknown): OmenState | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const omen = value as Partial<OmenState>;
  const fortune = ['大吉', '小吉', '平', '小凶'].includes(omen.fortune ?? '')
    ? (omen.fortune as OmenState['fortune'])
    : '平';
  return {
    fortune,
    favors: Array.isArray(omen.favors) ? omen.favors.filter((item): item is string => typeof item === 'string') : [],
    verse: typeof omen.verse === 'string' ? omen.verse : '星斗未明，宜静观其变。',
    rolledAt: typeof omen.rolledAt === 'string' ? omen.rolledAt : new Date(0).toISOString()
  };
}

function normalizeHomestead(value: Partial<HomesteadState> | undefined): HomesteadState {
  const spiritBeast = value?.spiritBeast;
  const treasureBasin = value?.treasureBasin;
  return {
    omen: normalizeOmen(value?.omen),
    treasureBasin: {
      dayKey: typeof treasureBasin?.dayKey === 'string' ? treasureBasin.dayKey : null,
      dailyCondenses: positiveInteger(treasureBasin?.dailyCondenses),
      lastCondensedAt:
        typeof treasureBasin?.lastCondensedAt === 'string' ? treasureBasin.lastCondensedAt : null
    },
    spiritBeast: {
      name: typeof spiritBeast?.name === 'string' ? spiritBeast.name : initialLedger.homestead.spiritBeast.name,
      status: spiritBeast?.status === 'traveling' ? 'traveling' : 'idle',
      route: typeof spiritBeast?.route === 'string' ? spiritBeast.route : null,
      lastDispatchedAt:
        typeof spiritBeast?.lastDispatchedAt === 'string' ? spiritBeast.lastDispatchedAt : null,
      returnsAt: typeof spiritBeast?.returnsAt === 'string' ? spiritBeast.returnsAt : null
    },
    inventory: Array.isArray(value?.inventory)
      ? value.inventory
          .filter((item): item is InventoryItem => Boolean(item && typeof item.name === 'string'))
          .map((item) => ({
            id: typeof item.id === 'string' ? item.id : createId('item', new Date(item.createdAt ?? 0)),
            name: item.name,
            kind: ['herb', 'stone', 'pill', 'curio'].includes(item.kind) ? item.kind : 'curio',
            quantity: positiveInteger(item.quantity) || 1,
            createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date(0).toISOString(),
            description: typeof item.description === 'string' ? item.description : ''
          }))
      : [],
    logs: Array.isArray(value?.logs)
      ? value.logs
          .filter((log): log is HomesteadLog => Boolean(log && typeof log.title === 'string'))
          .map((log) => ({
            id: typeof log.id === 'string' ? log.id : createId('log', new Date(log.occurredAt ?? 0)),
            type: ['omen', 'treasure', 'beast'].includes(log.type) ? log.type : 'omen',
            title: log.title,
            body: typeof log.body === 'string' ? log.body : '',
            occurredAt: typeof log.occurredAt === 'string' ? log.occurredAt : new Date(0).toISOString()
          }))
      : []
  };
}

function getDataDir() {
  const configuredDataDir = process.env.TOKEN_GAME_DATA_DIR;
  const defaultDataDir = process.cwd().includes(`${join('apps', 'server')}`)
    ? resolve(process.cwd(), 'data')
    : resolve(process.cwd(), 'apps', 'server', 'data');
  return configuredDataDir ? resolve(configuredDataDir) : defaultDataDir;
}

function getLedgerPath() {
  return resolve(getDataDir(), 'ledger.json');
}

function normalizeLedger(ledger: Partial<Ledger>): Ledger {
  const legacyPlayer = ledger.player as Partial<PlayerState> & {
    food?: number;
    processorLevel?: number;
  } | undefined;
  const cultivation = normalizeCultivationState({
    realm: legacyPlayer?.realm,
    realmLevel: legacyPlayer?.realmLevel ?? legacyPlayer?.processorLevel,
    qi: legacyPlayer?.qi ?? legacyPlayer?.food,
    spiritStone: legacyPlayer?.spiritStone,
    spiritHerb: legacyPlayer?.spiritHerb,
    pills: legacyPlayer?.pills,
    cultivation: legacyPlayer?.cultivation,
    currentPage: legacyPlayer?.currentPage
  });

  return {
    player: {
      kittenName: ledger.player?.kittenName ?? initialLedger.player.kittenName,
      ...cultivation,
      totalTokens: ledger.player?.totalTokens ?? initialLedger.player.totalTokens,
      lastFedAt: ledger.player?.lastFedAt ?? initialLedger.player.lastFedAt,
      kindling: positiveInteger(ledger.player?.kindling)
    },
    events: Array.isArray(ledger.events)
      ? ledger.events.map((event) => ({
          ...event,
          qiGained: event.qiGained ?? event.foodGained ?? 0
        }))
      : [],
    trackerState: {
      bucketTokens:
        ledger.trackerState?.bucketTokens && typeof ledger.trackerState.bucketTokens === 'object'
          ? { ...ledger.trackerState.bucketTokens }
          : {},
      lastSyncedAt: ledger.trackerState?.lastSyncedAt ?? initialLedger.trackerState.lastSyncedAt
    },
    homestead: normalizeHomestead(ledger.homestead)
  };
}

function ensureDataDir() {
  const dataDir = getDataDir();
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
}

function ensureParentDir(filePath: string) {
  const parent = dirname(filePath);
  if (!existsSync(parent)) {
    mkdirSync(parent, { recursive: true });
  }
}

export function ensureLedger() {
  ensureDataDir();
  const ledgerPath = getLedgerPath();

  if (!existsSync(ledgerPath)) {
    writeLedger(initialLedger);
  }
}

export function readLedger(): Ledger {
  ensureLedger();
  const ledgerPath = getLedgerPath();
  return normalizeLedger(JSON.parse(readFileSync(ledgerPath, 'utf8')) as Partial<Ledger>);
}

export function writeLedger(ledger: Ledger) {
  const ledgerPath = getLedgerPath();
  ensureParentDir(ledgerPath);
  writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2));
}

export function appendEvent(event: StoredEvent) {
  updateLedger((ledger) => {
    applyStoredEvent(ledger, event);
  });
}

export function applyStoredEvent(ledger: Ledger, event: StoredEvent) {
  ledger.events.unshift(event);
  ledger.player.qi += event.qiGained;
  ledger.player.kindling += Math.max(1, Math.floor(event.qiGained / 5));
  ledger.player.totalTokens += event.tokenCount;
  ledger.player.lastFedAt = event.occurredAt;
}

export function updateLedgerFile(ledgerFilePath: string, mutator: (ledger: Ledger) => void) {
  const ledger = existsSync(ledgerFilePath)
    ? normalizeLedger(JSON.parse(readFileSync(ledgerFilePath, 'utf8')) as Partial<Ledger>)
    : normalizeLedger({});

  mutator(ledger);
  ensureParentDir(ledgerFilePath);
  writeFileSync(ledgerFilePath, JSON.stringify(ledger, null, 2));
}

export function purgeMockEventsFromLedger(ledger: Ledger) {
  const mockEvents = ledger.events.filter((event) => event.source === 'mock');
  if (mockEvents.length === 0) {
    return 0;
  }

  const mockTokens = mockEvents.reduce((sum, event) => sum + event.tokenCount, 0);
  const mockQi = mockEvents.reduce((sum, event) => sum + event.qiGained, 0);
  ledger.events = ledger.events.filter((event) => event.source !== 'mock');
  ledger.player.totalTokens = Math.max(0, ledger.player.totalTokens - mockTokens);
  ledger.player.qi = Math.max(0, ledger.player.qi - mockQi);
  ledger.player.kindling = Math.max(0, ledger.player.kindling - mockEvents.length);
  ledger.player.lastFedAt = ledger.events[0]?.occurredAt ?? null;
  return mockEvents.length;
}

export function purgeMockEventsFromLedgerFile(ledgerFilePath: string) {
  let purged = 0;
  updateLedgerFile(ledgerFilePath, (ledger) => {
    purged = purgeMockEventsFromLedger(ledger);
  });
  return purged;
}

export function updateLedger(mutator: (ledger: Ledger) => void) {
  const ledger = readLedger();
  mutator(ledger);
  writeLedger(ledger);
}

export function purgeMockEvents() {
  let purged = 0;
  updateLedger((ledger) => {
    purged = purgeMockEventsFromLedger(ledger);
  });
  return purged;
}

export function createCultivationLedger(): Ledger {
  return normalizeLedger({});
}

export function practiceOnce(ledger: Ledger) {
  const cost = getPracticeCost(ledger.player.realmLevel);
  if (ledger.player.qi < cost) {
    return false;
  }

  ledger.player.qi -= cost;
  ledger.player.cultivation += Math.floor(cost * 1.5);
  ledger.player.currentPage = 'practice';
  return true;
}

export function farmOnce(ledger: Ledger) {
  ledger.player.spiritHerb += 3 + ledger.player.realmLevel;
  ledger.player.spiritStone += 2;
  ledger.player.currentPage = 'farm';
  return true;
}

export function meditateOnce(ledger: Ledger) {
  ledger.player.qi += 6 + ledger.player.realmLevel;
  ledger.player.cultivation += 4 + ledger.player.realmLevel;
  ledger.player.currentPage = 'meditate';
  return true;
}

export function runAlchemy(ledger: Ledger) {
  const yieldCount = getAlchemyYield(ledger.player.spiritHerb, ledger.player.spiritStone);
  if (yieldCount <= 0) {
    ledger.player.currentPage = 'alchemy';
    return false;
  }

  ledger.player.spiritHerb -= yieldCount;
  ledger.player.spiritStone -= yieldCount;
  ledger.player.pills += yieldCount;
  ledger.player.currentPage = 'alchemy';
  return true;
}

export function breakthroughOnce(ledger: Ledger) {
  const cost = 100 * 2 ** ledger.player.realmLevel;
  if (ledger.player.cultivation < cost || ledger.player.pills < 1) {
    return false;
  }

  ledger.player.cultivation -= cost;
  ledger.player.pills -= 1;
  ledger.player.realmLevel += 1;
  ledger.player.realm = realmNameForLevel(ledger.player.realmLevel);
  return true;
}

export function rollDivination(ledger: Ledger, now = new Date()): OmenState {
  const fortunes: OmenState['fortune'][] = ['平', '小吉', '大吉', '小凶'];
  const favorSets = [
    ['种田', '炼丹', '出游'],
    ['打坐', '修炼', '会客'],
    ['炼丹', '蕴养', '闭关'],
    ['聚宝', '观星', '灵田']
  ];
  const fortune = pickByDate(fortunes, now, 9);
  const favors = pickByDate(favorSets, now, 17);
  const omen: OmenState = {
    fortune,
    favors,
    verse:
      fortune === '小吉'
        ? '斗柄微斜，炉火不躁，宜蓄气养神。'
        : fortune === '大吉'
          ? '星河入怀，诸事可为，宜开炉远行。'
          : fortune === '小凶'
            ? '云翳遮斗，宜守不宜争。'
            : '天机平稳，照常打理洞府即可。',
    rolledAt: now.toISOString()
  };

  ledger.homestead.omen = omen;
  prependLog(ledger, {
    id: createId('omen', now),
    type: 'omen',
    title: `今日卦象：${omen.fortune}`,
    body: `宜 ${omen.favors.join('、')}。${omen.verse}`,
    occurredAt: now.toISOString()
  });
  return omen;
}

export function condenseTreasure(ledger: Ledger, now = new Date()): InventoryItem | null {
  const today = dayKeyFor(now);
  if (ledger.homestead.treasureBasin.dayKey !== today) {
    ledger.homestead.treasureBasin.dayKey = today;
    ledger.homestead.treasureBasin.dailyCondenses = 0;
  }

  if (ledger.player.kindling < 1 || ledger.homestead.treasureBasin.dailyCondenses >= 3) {
    return null;
  }

  const lootTable: Array<Omit<InventoryItem, 'id' | 'createdAt'>> = [
    {
      name: '月露灵石',
      kind: 'stone',
      quantity: 2,
      description: '聚宝盆凝出的温润灵石，可入库充作修行资粮。'
    },
    {
      name: '百年灵芝',
      kind: 'herb',
      quantity: 1,
      description: '带有晨露的灵芝，适合入炉炼丹。'
    },
    {
      name: '静心丹',
      kind: 'pill',
      quantity: 1,
      description: '香气清淡的小丹，可辅助突破前稳固心神。'
    },
    {
      name: '残卷玉签',
      kind: 'curio',
      quantity: 1,
      description: '记着一段残缺口诀的玉签，暂存入洞府库房。'
    }
  ];
  const chosen = pickByDate(lootTable, now, 26);
  const item: InventoryItem = {
    ...chosen,
    id: createId('loot', now),
    createdAt: now.toISOString()
  };

  ledger.player.kindling -= 1;
  ledger.homestead.inventory.unshift(item);
  ledger.homestead.inventory = ledger.homestead.inventory.slice(0, 48);
  ledger.homestead.treasureBasin.dailyCondenses += 1;
  ledger.homestead.treasureBasin.lastCondensedAt = now.toISOString();

  if (item.kind === 'herb') {
    ledger.player.spiritHerb += item.quantity;
  } else if (item.kind === 'stone') {
    ledger.player.spiritStone += item.quantity;
  } else if (item.kind === 'pill') {
    ledger.player.pills += item.quantity;
  }

  prependLog(ledger, {
    id: createId('treasure', now),
    type: 'treasure',
    title: `聚宝盆凝出${item.name}`,
    body: `投入一缕薪火，得 ${item.name} x${item.quantity}。`,
    occurredAt: now.toISOString()
  });
  return item;
}

export function dispatchSpiritBeast(ledger: Ledger, now = new Date()) {
  if (ledger.homestead.spiritBeast.status === 'traveling' || ledger.player.spiritStone < 1) {
    return false;
  }

  const routes = ['后山药径', '云桥集市', '松风古道'];
  const route = pickByDate(routes, now, 5);
  ledger.player.spiritStone -= 1;
  ledger.homestead.spiritBeast.status = 'traveling';
  ledger.homestead.spiritBeast.route = route;
  ledger.homestead.spiritBeast.lastDispatchedAt = now.toISOString();
  ledger.homestead.spiritBeast.returnsAt = new Date(now.getTime() + 30 * 60_000).toISOString();
  prependLog(ledger, {
    id: createId('beast-dispatch', now),
    type: 'beast',
    title: `灵兽出游：${route}`,
    body: `${ledger.homestead.spiritBeast.name}衔符下山，半个时辰后归来。`,
    occurredAt: now.toISOString()
  });
  return true;
}

export function advanceHomestead(ledger: Ledger, now = new Date()) {
  const beast = ledger.homestead.spiritBeast;
  if (beast.status !== 'traveling' || !beast.returnsAt || Date.parse(beast.returnsAt) > now.getTime()) {
    return false;
  }

  const herbReward = 2 + Math.floor(ledger.player.realmLevel / 2);
  ledger.player.spiritHerb += herbReward;
  beast.status = 'idle';
  beast.route = null;
  beast.returnsAt = null;
  prependLog(ledger, {
    id: createId('beast-return', now),
    type: 'beast',
    title: '灵兽归山',
    body: `${beast.name}带回灵草 x${herbReward}，抖落一身山岚。`,
    occurredAt: now.toISOString()
  });
  return true;
}
