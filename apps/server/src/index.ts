import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { tokenEventSchema, tokenEventToResourceDelta } from '@token-game/shared';
import { appendEvent, ensureLedger, readLedger, updateLedger } from './store';

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
    source: 'mock' | 'manual-import' | 'openai';
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
};

const DEFAULT_TICK_INTERVAL_MS = 5000;

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

function createMockEvent(sequence: number) {
  const tokenCount = 40 + ((sequence * 37) % 160);
  const kinds = ['input', 'output', 'cached', 'reasoning'] as const;
  const event = {
    id: `evt-${sequence}`,
    source: 'mock',
    model: 'gpt-5-mini',
    kind: kinds[sequence % kinds.length],
    tokenCount,
    occurredAt: new Date().toISOString(),
    metadata: {
      sequence,
      generator: 'interval'
    }
  };

  return tokenEventSchema.parse(event);
}

function getProcessorCost(level: number) {
  return 25 * 2 ** level;
}

function getFoodGainedForEvent(sequence: number) {
  const event = createMockEvent(sequence);
  const ledger = readLedger();
  const baseFood = tokenEventToResourceDelta(event).food;
  const bonusFood = ledger.player.processorLevel * 2;

  return {
    event,
    foodGained: baseFood + bonusFood
  };
}

async function ensurePlayerState() {
  ensureLedger();
}

async function seedInitialEventIfNeeded() {
  const existingCount = readLedger().events.length;
  if (existingCount > 0) {
    return;
  }

  const { event, foodGained } = getFoodGainedForEvent(1);
  appendEvent({ ...event, foodGained });
}

async function tickMockProgression() {
  const sequence = readLedger().events.length + 1;
  const { event, foodGained } = getFoodGainedForEvent(sequence);

  appendEvent({ ...event, foodGained });
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
    return readGameState();
  });

  app.post('/api/actions/burst', async () => {
    await tickMockProgression();
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
  await seedInitialEventIfNeeded();

  const interval = setInterval(() => {
    void tickMockProgression().catch((error) => {
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
