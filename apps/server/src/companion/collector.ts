import { createHash } from 'node:crypto';
import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs';
import { open, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { CompanionState, ConnectionStatus, ForgeRequest, ForgeResult } from '@token-game/shared';
import { SaveStore, type CompanionSave, type Cursor } from './save';
import { drawWeapons, dismantleWeapon, dismantleWeapons, exchangeWeapon, secureRandom } from './forge';

type Options = {
  dataDir: string;
  codexHome?: string;
  now?: () => Date;
  onState?: (state: CompanionState) => void;
  random?: () => number;
};
class FormatError extends Error {}
const emptyCursor = (): Cursor => ({ offset: 0, signature: '', signatureBytes: 0, sessionId: null, startedAt: null, forked: false });
export const localDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export const defaultCodexHome = () => path.resolve(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'));

function safeCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function cumulativeTotal(usage: Record<string, unknown>) {
  if (safeCount(usage.total_tokens)) return usage.total_tokens;
  if (safeCount(usage.input_tokens) && safeCount(usage.output_tokens) && safeCount(usage.input_tokens + usage.output_tokens)) {
    return usage.input_tokens + usage.output_tokens;
  }
  throw new FormatError('暂不支持这份 Codex 用量记录，已保留原有进度。');
}
function prefix(file: string, bytes: number) {
  const fd = openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(bytes);
    const length = readSync(fd, buffer, 0, bytes, 0);
    return createHash('sha256').update(buffer.subarray(0, length)).digest('hex');
  } finally { closeSync(fd); }
}

// Bound reads to the snapshotted file size and retain incomplete final lines.
async function readLines(file: string, offset: number, end: number, accept: (line: string) => void) {
  const fd = await open(file, 'r');
  let position = offset;
  let consumed = offset;
  let pending = Buffer.alloc(0);
  try {
    const buffer = Buffer.alloc(64 * 1024);
    while (position < end) {
      const { bytesRead: length } = await fd.read(buffer, 0, Math.min(buffer.length, end - position), position);
      if (!length) break;
      position += length;
      pending = Buffer.concat([pending, buffer.subarray(0, length)]);
      let start = 0;
      for (let i = 0; i < pending.length; i++) {
        if (pending[i] !== 10) continue;
        accept(pending.subarray(start, i).toString('utf8').replace(/\r$/, ''));
        consumed += i + 1 - start;
        start = i + 1;
      }
      pending = pending.subarray(start);
      if (pending.length > 32 * 1024 * 1024) throw new FormatError('Codex 日志单行过大，暂时停止读取。');
    }
    return consumed;
  } finally { await fd.close(); }
}

export class CodexCollector {
  readonly store: SaveStore;
  private save: CompanionSave;
  private now: () => Date;
  private queue: Promise<unknown> = Promise.resolve();
  private timer?: ReturnType<typeof setTimeout>;
  private closed = false;
  private status: ConnectionStatus = 'waiting';
  private message = '等待 Codex 的新用量';
  private lastCheckedAt: string | null = null;
  private observations = new Map<string, { stamp: string; offset: number; signature: string }>();

  constructor(private options: Options) {
    this.now = options.now ?? (() => new Date());
    this.store = new SaveStore(options.dataDir);
    this.save = this.store.load(path.resolve(options.codexHome ?? defaultCodexHome()), this.now());
  }

  state(): CompanionState {
    return {
      forge: {
        revision: this.save.forge.revision, balance: this.save.acknowledgedTokens - this.save.forge.spentTokens,
        spentTokens: this.save.forge.spentTokens, shards: this.save.forge.shards,
        inventory: { ...this.save.forge.inventory }, draws: this.save.forge.draws,
        sinceRare: this.save.forge.sinceRare, sinceLegendary: this.save.forge.sinceLegendary,
        lastDraw: [...this.save.forge.lastDraw]
      },
      totalTokens: this.save.totalTokens,
      todayTokens: this.save.daily[localDate(this.now())] ?? 0,
      pendingTokens: this.save.totalTokens - this.save.acknowledgedTokens,
      acknowledgedTokens: this.save.acknowledgedTokens,
      legacyTokens: this.save.legacyTokens,
      boundAt: this.save.boundAt,
      receipt: { ...this.save.receipt },
      connection: {
        status: this.status, directory: this.save.codexHome,
        lastCheckedAt: this.lastCheckedAt, lastUsageAt: this.save.lastUsageAt,
        message: this.message, recovered: this.store.recovered
      }
    };
  }

  private serialized<T>(action: () => Promise<T> | T): Promise<T> {
    const work = this.queue.then(action);
    this.queue = work.catch(() => undefined);
    return work;
  }

  private publish() {
    try { this.options.onState?.(this.state()); }
    catch { /* A closing window must not stop the collector. */ }
  }
  private commit(next: CompanionSave) {
    this.store.commit(next);
    this.save = next;
  }

  async start(interval = 5000) {
    await this.scan();
    if (this.closed) return;
    const tick = async () => {
      if (this.closed) return;
      await this.scan();
      if (!this.closed) this.timer = setTimeout(tick, interval);
    };
    this.timer = setTimeout(tick, interval);
  }

  async close() {
    this.closed = true;
    clearTimeout(this.timer);
    await this.queue;
  }

  scan() {
    return this.serialized(async () => {
      const next = structuredClone(this.save);
      const errors: string[] = [];
      let formatError = false;
      let fileCount = 0;
      let supported = false;
      let changed = false;
      const walk = async (directory: string) => {
        let entries;
        try { entries = await readdir(directory, { withFileTypes: true }); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
          throw error;
        }
        for (const entry of entries) {
          const file = path.join(directory, entry.name);
          if (entry.isDirectory()) { await walk(file); continue; }
          if (!entry.isFile() || !/^rollout-.*\.jsonl$/.test(entry.name)) continue;
          fileCount++;
          try {
            const didRead = await this.readFile(next, file);
            changed ||= didRead;
            supported ||= Boolean(next.files[file]?.sessionId);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
            formatError ||= error instanceof FormatError;
            errors.push(error instanceof FormatError ? error.message : '无法读取部分 Codex 日志，请检查目录权限。');
          }
        }
      };
      try {
        if (!existsSync(next.codexHome)) {
          this.status = 'missing';
          this.message = '尚未找到 Codex 日志目录';
        } else {
          await walk(path.join(next.codexHome, 'sessions'));
          await walk(path.join(next.codexHome, 'archived_sessions'));
          if (changed) this.commit(next);
          const reset = Object.values(next.sessions).some(session => session.reset);
          if (errors.length || reset || (fileCount > 0 && !supported)) {
            this.status = formatError || reset || !supported ? 'unsupported' : 'error';
            this.message = errors[0] ?? (reset ? '用量累计出现回退，已暂停该会话的增量，等待超过原有记录。' : '暂不支持这份 Codex 日志格式');
          } else {
            this.status = next.lastUsageAt ? 'connected' : 'waiting';
            this.message = next.lastUsageAt ? 'Codex 已连接，自动收集新用量' : '等待 Codex 的新用量';
          }
        }
      } catch {
        this.status = 'error';
        this.message = '采集或保存失败，进度未推进，请检查目录与磁盘。';
      }
      this.lastCheckedAt = this.now().toISOString();
      this.publish();
      return this.state();
    });
  }

  private async readFile(sourceSave: CompanionSave, file: string) {
    const stat = statSync(file);
    const previous = sourceSave.files[file];
    const stamp = `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}:${stat.ino}`;
    const observed = this.observations.get(file);
    if (previous && observed?.stamp === stamp && observed.offset === previous.offset && observed.signature === previous.signature) return false;
    let cursor = previous ? { ...previous } : emptyCursor();
    if (stat.size < cursor.offset || (cursor.signatureBytes && prefix(file, cursor.signatureBytes) !== cursor.signature)) {
      cursor = emptyCursor();
    }
    if (stat.size === cursor.offset && previous) {
      this.observations.set(file, { stamp, offset: cursor.offset, signature: cursor.signature });
      return false;
    }
    const save = { ...sourceSave, sessions: { ...sourceSave.sessions }, daily: { ...sourceSave.daily } };
    if (!cursor.signatureBytes && stat.size) {
      cursor.signatureBytes = Math.min(256, stat.size);
      cursor.signature = prefix(file, cursor.signatureBytes);
    }
    const offset = await readLines(file, cursor.offset, stat.size, line => {
      if (!line.trim()) return;
      let record;
      try { record = JSON.parse(line); }
      catch { throw new FormatError('Codex 日志包含无法解析的完整记录，已暂停该文件。'); }
      const payload = record?.payload;
      if (record.type === 'session_meta') {
        if (typeof payload?.id !== 'string' || !payload.id) throw new FormatError('Codex 会话缺少标识，暂时无法计数。');
        cursor.sessionId = payload.id;
        cursor.startedAt = payload.timestamp ?? record.timestamp ?? null;
        cursor.forked = typeof payload.forked_from_id === 'string';
      }
      if (record.type !== 'event_msg' || payload?.type !== 'token_count' || payload.info == null) return;
      if (!cursor.sessionId || !payload.info.total_token_usage) throw new FormatError('Codex 用量缺少累计总量或会话标识。');
      const total = cumulativeTotal(payload.info.total_token_usage);
      const session = { ...(save.sessions[cursor.sessionId] ?? { total: 0, reset: false, lastSnapshotAt: null }) };
      const delta = Math.max(0, total - session.total);
      const timestamp = typeof record.timestamp === 'string' ? Date.parse(record.timestamp) : NaN;
      if (Number.isFinite(timestamp) && (!session.lastSnapshotAt || timestamp > Date.parse(session.lastSnapshotAt))) {
        session.reset = total < session.total;
        session.lastSnapshotAt = new Date(timestamp).toISOString();
      }
      if (total >= session.total) session.reset = false;
      session.total = Math.max(session.total, total);
      save.sessions[cursor.sessionId] = session;
      const inherited = cursor.forked && Number.isFinite(Date.parse(cursor.startedAt ?? '')) && timestamp <= Date.parse(cursor.startedAt!);
      if ((Number.isFinite(timestamp) && timestamp <= Date.parse(save.boundAt)) || inherited || !delta) return;
      // Undated records cannot safely distinguish pre-installation history.
      if (!Number.isFinite(timestamp)) throw new FormatError('Codex 用量记录缺少有效时间，已暂停该文件。');
      if (timestamp > this.now().getTime() + 5 * 60_000) throw new FormatError('Codex 用量时间超前，请检查系统时间。');
      if (!safeCount(save.totalTokens + delta)) throw new FormatError('Token 累计超出可保存范围。');
      save.totalTokens += delta;
      const day = localDate(new Date(timestamp));
      save.daily[day] = (save.daily[day] ?? 0) + delta;
      if (!save.lastUsageAt || timestamp > Date.parse(save.lastUsageAt)) save.lastUsageAt = new Date(timestamp).toISOString();
    });
    cursor.offset = offset;
    save.files[file] = cursor;
    Object.assign(sourceSave, save);
    this.observations.set(file, { stamp, offset: cursor.offset, signature: cursor.signature });
    return !previous || JSON.stringify(cursor) !== JSON.stringify(previous);
  }

  acknowledge(observedTotal: number) {
    return this.serialized(() => {
      if (!safeCount(observedTotal) || observedTotal > this.save.totalTokens) throw new Error('INVALID_SNAPSHOT');
      const tokens = Math.max(0, observedTotal - this.save.acknowledgedTokens);
      if (tokens) {
        const next = structuredClone(this.save);
        next.acknowledgedTokens = observedTotal;
        next.receipt = { revision: next.receipt.revision + 1, tokens, at: this.now().toISOString() };
        this.commit(next);
        this.publish();
      }
      return { state: this.state(), collectedTokens: tokens };
    });
  }

  async setDirectory(directory: string) {
    if (!path.isAbsolute(directory)) throw new Error('请选择完整的 Codex 目录路径');
    let resolved = path.resolve(directory.trim());
    if (['sessions', 'archived_sessions'].includes(path.basename(resolved))) resolved = path.dirname(resolved);
    if (!statSync(resolved).isDirectory()) throw new Error('请选择一个可读取的文件夹');
    await this.serialized(() => {
      const next = structuredClone(this.save);
      next.codexHome = resolved;
      // Session high-water marks survive directory changes and archive moves.
      next.files = {};
      this.commit(next);
    });
    return this.scan();
  }

  private transact(request: ForgeRequest, key: string, action: (next: CompanionSave) => ForgeResult) {
    return this.serialized(() => {
      if (!request || typeof request.requestId !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(request.requestId) ||
        !safeCount(request.expectedRevision)) throw new Error('无效的操作请求');
      const previous = this.save.forge.recentActions.find(item => item.id === request.requestId);
      if (previous) {
        if (previous.key !== key) throw new Error('重复请求的内容不一致');
        return { state: this.state(), result: structuredClone(previous.result) };
      }
      if (request.expectedRevision !== this.save.forge.revision) throw new Error('进度已更新，请重试');
      const next = structuredClone(this.save);
      const result = action(next);
      next.forge.revision++;
      next.forge.recentActions = [...next.forge.recentActions, { id: request.requestId, key, result }].slice(-32);
      this.commit(next);
      this.publish();
      return { state: this.state(), result: structuredClone(result) };
    });
  }
  draw(request: ForgeRequest & { count: number }) {
    return this.transact(request, 'draw:' + request?.count, next => drawWeapons(next, request.count, this.options.random ?? secureRandom));
  }
  dismantle(request: ForgeRequest & { weaponId: string; quantity: number }) {
    return this.transact(request, 'dismantle:' + request?.weaponId + ':' + request?.quantity, next => dismantleWeapon(next, request.weaponId, request.quantity));
  }
  dismantleBatch(request: ForgeRequest & { weaponIds: string[] }) {
    const ids = Array.isArray(request?.weaponIds) ? [...request.weaponIds].sort() : request?.weaponIds;
    return this.transact(request, 'dismantle-batch:' + JSON.stringify(ids), next => dismantleWeapons(next, ids));
  }
  exchange(request: ForgeRequest & { weaponId: string }) {
    return this.transact(request, 'exchange:' + request?.weaponId, next => exchangeWeapon(next, request.weaponId));
  }
}
