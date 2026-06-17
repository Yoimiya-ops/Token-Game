import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ensureLedger, purgeMockEvents, readLedger, updateLedger } from './store';
import { syncTokenTrackerUsage } from './token-tracker';

type GameStateResponse = {
  player: {
    kittenName: string;
    food: number;
    totalTokens: number;
    lastFedAt: string | null;
    processorLevel: number;
    lifetimeFoodSpent: number;
  };
  progression: {
    nextProcessorCost: number;
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
    foodGained: number;
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

function getProcessorCost(level: number) {
  return 25 * 2 ** level;
}

async function ensurePlayerState() {
  ensureLedger();
  purgeMockEvents();
}

async function purchaseProcessorUpgrade() {
  let purchased = false;

  updateLedger((ledger) => {
    const cost = getProcessorCost(ledger.player.processorLevel);
    if (ledger.player.food < cost) {
      return;
    }

    ledger.player.food -= cost;
    ledger.player.processorLevel += 1;
    ledger.player.lifetimeFoodSpent += cost;
    purchased = true;
  });

  return purchased;
}

async function readGameState(): Promise<GameStateResponse> {
  const ledger = readLedger();
  const player = ledger.player;
  const events = ledger.events.slice(0, 12);

  return {
    player: {
      kittenName: player.kittenName,
      food: player.food,
      totalTokens: player.totalTokens,
      lastFedAt: player.lastFedAt,
      processorLevel: player.processorLevel,
      lifetimeFoodSpent: player.lifetimeFoodSpent
    },
    progression: {
      nextProcessorCost: getProcessorCost(player.processorLevel),
      passiveIntervalMs: DEFAULT_TICK_INTERVAL_MS
    },
    events: events.map((event) => ({
      id: event.id,
      source: event.source,
      model: event.model,
      kind: event.kind,
      tokenCount: event.tokenCount,
      occurredAt: event.occurredAt,
      foodGained: event.foodGained,
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

  app.post('/api/upgrades/processor', async (_, reply) => {
    const purchased = await purchaseProcessorUpgrade();
    if (!purchased) {
      reply.code(400);
      return {
        error: '猫粮不足，无法购买处理器升级。'
      };
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
