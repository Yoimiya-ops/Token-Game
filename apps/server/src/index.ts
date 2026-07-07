import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  advanceHomestead,
  backfillHistoricalKindling,
  breakthroughOnce,
  condenseTreasure,
  dispatchSpiritBeast,
  ensureLedger,
  farmOnce,
  type HomesteadState,
  meditateOnce,
  practiceOnce,
  purgeMockEvents,
  readLedger,
  rollDivination,
  runAlchemy,
  updateLedger,
  writeLedger
} from './store';
import { getTokenTrackerSyncStatus, syncTokenTrackerUsage, type TokenTrackerSyncStatus } from './token-tracker';
import { createSessionRoutes } from './session-receiver/routes';
import { readSessionStore, resolveSessionStorePath } from './session-receiver';
import { SessionDriver, liveSessionCount } from './token-tracker/session-driver';
import { getDefaultProviders } from './token-tracker/providers';

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
    kindling: number;
  };
  homestead: HomesteadState;
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
  tracker: TokenTrackerSyncStatus;
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
  /** Legacy local tracker scan. Defaults to false now that SessionDriver
   *  owns live token ingestion; tests can still opt in explicitly. */
  runExternalTrackerSync?: boolean;
  /** Override the on-disk path for the session-receiver store. Tests
   *  pass a tmpdir so each test gets a fresh empty store. */
  sessionStorePath?: string;
  /** When true (default), start the SessionDriver so the server runs
   *  its own 60s ticks on every open session. Tests can pass false
   *  to keep the driver inert. */
  enableSessionDriver?: boolean;
  /** Tick interval in ms. Defaults to 60s. Tests typically pass 50-100. */
  sessionDriverTickIntervalMs?: number;
  /** Injected SessionDriver (tests). When provided, the constructor
   *  uses this instance instead of building a new one. */
  sessionDriver?: SessionDriver;
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

function parseActionNow(value: unknown) {
  if (typeof value !== 'string') {
    return new Date();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function advanceLedgerTo(now = new Date()) {
  const ledger = readLedger();
  const backfilled = backfillHistoricalKindling(ledger, now);
  const advanced = advanceHomestead(ledger, now);
  if (backfilled > 0 || advanced) {
    writeLedger(ledger);
  }
  return ledger;
}

async function readGameState(now = new Date(), tokenTrackerQueuePath?: string): Promise<GameStateResponse> {
  const ledger = advanceLedgerTo(now);
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
      lastFedAt: player.lastFedAt,
      kindling: player.kindling
    },
    homestead: ledger.homestead,
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
    })),
    tracker: getTokenTrackerSyncStatus(tokenTrackerQueuePath)
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

  // ──────────────────────────────────────────────────────────────────
  // Session driver: server-side 60s ticker on every open session.
  // Built first so the routes below can hand off the
  // "manual-refresh" / "/active" endpoints to it.
  // ──────────────────────────────────────────────────────────────────
  const sessionStorePath = options.sessionStorePath;
  let sessionDriver: SessionDriver | null = null;
  if (options.enableSessionDriver !== false) {
    sessionDriver =
      options.sessionDriver ??
      new SessionDriver(sessionStorePath ?? resolveSessionStorePath(), {
        providers: getDefaultProviders(),
        tickIntervalMs: options.sessionDriverTickIntervalMs
      });
    for (const device of Object.values(readSessionStore(sessionStorePath).devices)) {
      if (device.openSession) {
        const r = await sessionDriver.reattach(device.deviceKey);
        if (r.ok) {
          app.log.info(
            { deviceKey: device.deviceKey, sessionId: r.session.sessionId },
            'session-driver reattached to pre-existing session'
          );
        }
      }
    }
    app.addHook('onClose', async () => {
      sessionDriver?.shutdown();
    });
    app.log.info({ liveSessions: liveSessionCount(sessionDriver) }, 'session-driver started');
  }

  // ──────────────────────────────────────────────────────────────────
  // Session-based receiver. This is the only live token-ingestion HTTP
  // path now; the old trust-batch receiver has been removed.
  // ──────────────────────────────────────────────────────────────────
  await createSessionRoutes(app, {
    storePath: options.sessionStorePath,
    sessionDriver: sessionDriver ?? undefined
  });

  app.get('/health/session-driver', async () => ({
    ok: true,
    liveSessions: sessionDriver ? liveSessionCount(sessionDriver) : 0
  }));

  app.get('/api/state', async () => {
    await syncTokenTrackerUsage({
      queuePath: options.tokenTrackerQueuePath,
      runExternalSync: options.runExternalTrackerSync ?? false
    });
    return readGameState(new Date(), options.tokenTrackerQueuePath);
  });

  app.post('/api/actions/burst', async () => {
    await syncTokenTrackerUsage({
      queuePath: options.tokenTrackerQueuePath,
      runExternalSync: options.runExternalTrackerSync ?? false
    });
    return readGameState(new Date(), options.tokenTrackerQueuePath);
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

  app.post('/api/actions/divination', async () => {
    const now = new Date();
    updateLedger((ledger) => {
      rollDivination(ledger, now);
    });
    return readGameState(now);
  });

  app.post('/api/actions/treasure-basin/condense', async (_, reply) => {
    const now = new Date();
    let applied = false;
    updateLedger((ledger) => {
      applied = condenseTreasure(ledger, now) !== null;
    });
    if (!applied) {
      reply.code(400);
      return { error: '薪火不足，或聚宝盆今日凝物次数已满。' };
    }
    return readGameState(now);
  });

  app.post('/api/actions/beast/dispatch', async (_, reply) => {
    const now = new Date();
    let applied = false;
    updateLedger((ledger) => {
      applied = dispatchSpiritBeast(ledger, now);
    });
    if (!applied) {
      reply.code(400);
      return { error: '灵兽尚未归来，或灵石不足。' };
    }
    return readGameState(now);
  });

  app.post('/api/actions/tick', async (request) => {
    const now = parseActionNow((request.body as { now?: unknown } | null)?.now);
    updateLedger((ledger) => {
      advanceHomestead(ledger, now);
    });
    return readGameState(now);
  });

  app.get('/', async (_, reply) => {
    return reply.sendFile('index.html');
  });

  await ensurePlayerState();

  await syncTokenTrackerUsage({
    queuePath: options.tokenTrackerQueuePath,
    runExternalSync: options.runExternalTrackerSync ?? false
  });

  const interval = setInterval(() => {
    void syncTokenTrackerUsage({
      queuePath: options.tokenTrackerQueuePath,
      runExternalSync: options.runExternalTrackerSync ?? false
    })
      .then(() => {
        updateLedger((ledger) => {
          backfillHistoricalKindling(ledger);
          advanceHomestead(ledger);
        });
      })
      .catch((error: unknown) => {
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
