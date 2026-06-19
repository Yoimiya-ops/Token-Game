import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  breakthroughOnce,
  ensureLedger,
  farmOnce,
  meditateOnce,
  practiceOnce,
  purgeMockEvents,
  readLedger,
  runAlchemy,
  updateLedger
} from './store';
import { syncTokenTrackerUsage } from './token-tracker';

type GameStateResponse = {
  player: {
    kittenName: string;
    realm: string;
    realmLevel: number;
    qi: number;
    spiritStone: number;
    spiritHerb: number;
    pills: number;
    cultivation: number;
    totalTokens: number;
    lastFedAt: string | null;
  };
  progression: {
    nextPracticeCost: number;
    nextBreakthroughCost: number;
    passiveIntervalMs: number;
  };
  events: Array<{
    id: string;
    source: 'mock' | 'manual-import' | 'openai' | 'tokentracker';
    model: string;
    kind: 'input' | 'output' | 'cached' | 'reasoning';
    tokenCount: number;
    occurredAt: string;
    metadata?: Record<string, string | number | boolean>;
    qiGained: number;
  }>;
};

type ServerOptions = {
  port?: number;
  host?: string;
  staticRoot?: string;
  tickIntervalMs?: number;
};

type GameAppOptions = {
  staticRoot?: string;
  tickIntervalMs?: number;
  tokenTrackerQueuePath?: string;
  runExternalTrackerSync?: boolean;
};

const DEFAULT_TICK_INTERVAL_MS = 30_000;

export function resolveWebStaticRoot(cwd = process.cwd()) {
  let current = path.resolve(cwd);

  while (true) {
    const webRoot = path.join(current, 'apps', 'web');
    const candidate = path.join(current, 'apps', 'web', 'dist');
    if (existsSync(webRoot) || existsSync(path.join(candidate, 'index.html'))) {
      return candidate;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return path.resolve(cwd, 'apps', 'web', 'dist');
    }

    current = parent;
  }
}

export const resolveStaticRoot = resolveWebStaticRoot;

async function ensurePlayerState() {
  ensureLedger();
  purgeMockEvents();
}

function getPracticeCost(level: number) {
  return 12 * 2 ** level;
}

function getBreakthroughCost(level: number) {
  return 100 * 2 ** level;
}

async function runLedgerAction(action: 'practice' | 'farm' | 'meditate' | 'alchemy' | 'breakthrough') {
  let applied = false;
  updateLedger((ledger) => {
    if (action === 'practice') {
      applied = practiceOnce(ledger);
    } else if (action === 'farm') {
      applied = farmOnce(ledger);
    } else if (action === 'meditate') {
      applied = meditateOnce(ledger);
    } else if (action === 'alchemy') {
      applied = runAlchemy(ledger);
    } else {
      applied = breakthroughOnce(ledger);
    }
  });
  return applied;
}

async function readGameState(): Promise<GameStateResponse> {
  const ledger = readLedger();
  const player = ledger.player;
  const events = ledger.events.slice(0, 12);

  return {
    player: {
      kittenName: player.kittenName,
      realm: player.realm,
      realmLevel: player.realmLevel,
      qi: player.qi,
      spiritStone: player.spiritStone,
      spiritHerb: player.spiritHerb,
      pills: player.pills,
      cultivation: player.cultivation,
      totalTokens: player.totalTokens,
      lastFedAt: player.lastFedAt
    },
    progression: {
      nextPracticeCost: getPracticeCost(player.realmLevel),
      nextBreakthroughCost: getBreakthroughCost(player.realmLevel),
      passiveIntervalMs: DEFAULT_TICK_INTERVAL_MS
    },
    events: events.map((event) => ({
      id: event.id,
      source: event.source,
      model: event.model,
      kind: event.kind,
      tokenCount: event.tokenCount,
      occurredAt: event.occurredAt,
      qiGained: event.qiGained,
      metadata: event.metadata
    }))
  };
}

export async function createGameApp(options: GameAppOptions = {}) {
  const tickIntervalMs = options.tickIntervalMs ?? DEFAULT_TICK_INTERVAL_MS;
  const app = Fastify({ logger: true });
  const staticRoot = options.staticRoot ?? resolveWebStaticRoot();

  await app.register(cors, { origin: true });
  await app.register(fastifyStatic, {
    root: staticRoot,
    index: false
  });

  app.get('/health', async () => ({ ok: true }));

  app.get('/api/state', async () => {
    await syncTokenTrackerUsage({
      queuePath: options.tokenTrackerQueuePath,
      runExternalSync: options.runExternalTrackerSync
    });
    return readGameState();
  });

  app.post('/api/actions/burst', async () => {
    await syncTokenTrackerUsage({
      queuePath: options.tokenTrackerQueuePath,
      runExternalSync: options.runExternalTrackerSync
    });
    return readGameState();
  });

  app.post('/api/actions/practice', async (_, reply) => {
    if (!(await runLedgerAction('practice'))) {
      reply.code(400);
      return { error: '灵气不足，无法继续修炼。' };
    }
    return readGameState();
  });

  app.post('/api/actions/farm', async () => {
    await runLedgerAction('farm');
    return readGameState();
  });

  app.post('/api/actions/meditate', async () => {
    await runLedgerAction('meditate');
    return readGameState();
  });

  app.post('/api/actions/alchemy', async (_, reply) => {
    if (!(await runLedgerAction('alchemy'))) {
      reply.code(400);
      return { error: '灵草或灵石不足，丹炉无法开火。' };
    }
    return readGameState();
  });

  app.post('/api/actions/breakthrough', async (_, reply) => {
    if (!(await runLedgerAction('breakthrough'))) {
      reply.code(400);
      return { error: '修为或丹药不足，尚不可突破。' };
    }
    return readGameState();
  });

  app.get('/', async (_, reply) => {
    return reply.sendFile('index.html');
  });

  await ensurePlayerState();
  await syncTokenTrackerUsage({
    queuePath: options.tokenTrackerQueuePath,
    runExternalSync: options.runExternalTrackerSync
  });

  const interval = setInterval(() => {
    void syncTokenTrackerUsage({
      queuePath: options.tokenTrackerQueuePath,
      runExternalSync: options.runExternalTrackerSync
    }).catch((error) => {
      app.log.error(error);
    });
  }, tickIntervalMs);

  app.addHook('onClose', async () => {
    clearInterval(interval);
  });

  return app;
}

export async function startGameServer(options: ServerOptions = {}) {
  const port = options.port ?? 3001;
  const host = options.host ?? '127.0.0.1';
  const app = await createGameApp(options);

  await app.listen({ port, host });
  return app;
}
