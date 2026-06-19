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
};

export type Ledger = {
  player: PlayerState;
  events: StoredEvent[];
  trackerState: TrackerState;
};

const initialLedger: Ledger = {
  player: {
    kittenName: 'Mochi',
    ...normalizeCultivationState(undefined),
    totalTokens: 0,
    lastFedAt: null
  },
  events: [],
  trackerState: {
    bucketTokens: {},
    lastSyncedAt: null
  }
};

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
      lastFedAt: ledger.player?.lastFedAt ?? initialLedger.player.lastFedAt
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
    }
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
