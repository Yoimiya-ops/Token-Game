import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { CodexCollector } from './companion/collector';
import type { CompanionState } from '@token-game/shared';

declare module 'fastify' {
  interface FastifyInstance { companion: CodexCollector }
}

type GameAppOptions = {
  staticRoot?: string;
  dataDir?: string;
  codexHome?: string;
  tickIntervalMs?: number;
  startCollector?: boolean;
  now?: () => Date;
  onState?: (state: CompanionState) => void;
  petAssetRoot?: string;
};
type ServerOptions = GameAppOptions & { port?: number; host?: string };

export function resolveWebStaticRoot(cwd = process.cwd()) {
  let current = path.resolve(cwd);
  while (true) {
    const candidate = path.join(current, 'apps', 'web', 'dist');
    if (existsSync(path.join(current, 'apps', 'web')) || existsSync(path.join(candidate, 'index.html'))) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(cwd, 'apps', 'web', 'dist');
    current = parent;
  }
}
export const resolveStaticRoot = resolveWebStaticRoot;

export async function createGameApp(options: GameAppOptions = {}) {
  const app = Fastify({ logger: false });
  const companion = new CodexCollector({
    dataDir: options.dataDir ?? process.env.TOKEN_GAME_DATA_DIR ?? path.join(os.homedir(), '.token-game', 'data'),
    codexHome: options.codexHome, now: options.now, onState: options.onState
  });
  app.decorate('companion', companion);
  const staticRoot = options.staticRoot ?? resolveWebStaticRoot();
  const petAssetRoot = options.petAssetRoot ?? path.resolve(staticRoot, '../../../desktop/pet/assets/processed');
  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    if (origin && origin !== `http://${request.headers.host}` && origin !== 'http://localhost:3000' && origin !== 'http://127.0.0.1:3000') {
      return reply.code(403).send({ error: '请求来源不受支持' });
    }
  });
  app.addHook('onSend', async (_request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Cache-Control', 'no-store');
    reply.header('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'");
  });
  await app.register(fastifyStatic, { root: staticRoot, index: false });
  await app.register(fastifyStatic, { root: path.resolve(petAssetRoot, '../..'), prefix: '/pet/', decorateReply: false });
  app.get('/health', async () => ({ ok: true }));
  app.get('/favicon.ico', async (_request, reply) => reply.code(204).send());
  app.get('/api/state', async () => companion.state());
  app.post('/api/collect', async (request, reply) => {
    const observedTotal = (request.body as { observedTotal?: unknown } | null)?.observedTotal;
    if (typeof observedTotal !== 'number' || !Number.isSafeInteger(observedTotal) || observedTotal < 0 || observedTotal > companion.state().totalTokens) {
      return reply.code(400).send({ error: '这份收获已更新，请重新查看' });
    }
    try { return await companion.acknowledge(observedTotal); }
    catch { return reply.code(500).send({ error: '暂时未能保存，收获仍在，请稍后重试' }); }
  });
  app.post('/api/directory', async (request, reply) => {
    const directory = (request.body as { directory?: unknown } | null)?.directory;
    if (typeof directory !== 'string' || !directory.trim() || directory.length > 4096) {
      return reply.code(400).send({ error: '请选择 Codex 日志所在的文件夹' });
    }
    try { return await companion.setDirectory(directory); }
    catch { return reply.code(400).send({ error: '无法读取或保存这个目录，请检查路径与权限' }); }
  });
  app.get('/companion.webp', async (_request, reply) => reply.sendFile('jade-basin.webp', petAssetRoot));
  app.get('/', async (_request, reply) => reply.sendFile('index.html'));
  app.addHook('onClose', async () => companion.close());
  if (options.startCollector !== false) void companion.start(options.tickIntervalMs).catch(error => app.log.error(error));
  return app;
}
export async function startGameServer(options: ServerOptions = {}) {
  const app = await createGameApp(options);
  try { await app.listen({ port: options.port ?? 3001, host: options.host ?? '127.0.0.1' }); }
  catch (error) { await app.close(); throw error; }
  return app;
}
