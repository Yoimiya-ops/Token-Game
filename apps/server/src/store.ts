import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { TokenEvent } from '@token-game/shared';

export type StoredEvent = TokenEvent & {
  foodGained: number;
};

export type TrackerState = {
  bucketTokens: Record<string, number>;
  lastSyncedAt: string | null;
};

export type PlayerState = {
  kittenName: string;
  food: number;
  totalTokens: number;
  lastFedAt: string | null;
  processorLevel: number;
  lifetimeFoodSpent: number;
};

export type Ledger = {
  player: PlayerState;
  events: StoredEvent[];
  trackerState: TrackerState;
};

const configuredDataDir = process.env.TOKEN_GAME_DATA_DIR;
const defaultDataDir = process.cwd().includes(`${join('apps', 'server')}`)
  ? resolve(process.cwd(), 'data')
  : resolve(process.cwd(), 'apps', 'server', 'data');
const dataDir = configuredDataDir ? resolve(configuredDataDir) : defaultDataDir;
const ledgerPath = resolve(dataDir, 'ledger.json');

const initialLedger: Ledger = {
  player: {
    kittenName: 'Mochi',
    food: 0,
    totalTokens: 0,
    lastFedAt: null,
    processorLevel: 0,
    lifetimeFoodSpent: 0
  },
  events: [],
  trackerState: {
    bucketTokens: {},
    lastSyncedAt: null
  }
};

function normalizeLedger(ledger: Partial<Ledger>): Ledger {
  return {
    player: {
      kittenName: ledger.player?.kittenName ?? initialLedger.player.kittenName,
      food: ledger.player?.food ?? initialLedger.player.food,
      totalTokens: ledger.player?.totalTokens ?? initialLedger.player.totalTokens,
      lastFedAt: ledger.player?.lastFedAt ?? initialLedger.player.lastFedAt,
      processorLevel: ledger.player?.processorLevel ?? initialLedger.player.processorLevel,
      lifetimeFoodSpent: ledger.player?.lifetimeFoodSpent ?? initialLedger.player.lifetimeFoodSpent
    },
    events: Array.isArray(ledger.events) ? ledger.events : [],
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

  if (!existsSync(ledgerPath)) {
    writeLedger(initialLedger);
  }
}

export function readLedger(): Ledger {
  ensureLedger();
  return normalizeLedger(JSON.parse(readFileSync(ledgerPath, 'utf8')) as Partial<Ledger>);
}

export function writeLedger(ledger: Ledger) {
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
  ledger.player.food += event.foodGained;
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
  const mockFood = mockEvents.reduce((sum, event) => sum + event.foodGained, 0);
  ledger.events = ledger.events.filter((event) => event.source !== 'mock');
  ledger.player.totalTokens = Math.max(0, ledger.player.totalTokens - mockTokens);
  ledger.player.food = Math.max(0, ledger.player.food - mockFood);
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
