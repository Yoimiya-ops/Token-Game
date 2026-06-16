import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { TokenEvent } from '@token-game/shared';

export type StoredEvent = TokenEvent & {
  foodGained: number;
};

export type PlayerState = {
  kittenName: string;
  food: number;
  totalTokens: number;
  lastFedAt: string | null;
  processorLevel: number;
  lifetimeFoodSpent: number;
};

type Ledger = {
  player: PlayerState;
  events: StoredEvent[];
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
  events: []
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
    events: Array.isArray(ledger.events) ? ledger.events : []
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
    ledger.events.unshift(event);
    ledger.player.food += event.foodGained;
    ledger.player.totalTokens += event.tokenCount;
    ledger.player.lastFedAt = event.occurredAt;
  });
}

export function updateLedger(mutator: (ledger: Ledger) => void) {
  const ledger = readLedger();
  mutator(ledger);
  writeLedger(ledger);
}
