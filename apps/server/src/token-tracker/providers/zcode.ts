import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Provider } from './base';
import type { FileCursor, RawEvent, TokenKind } from '../types';
import { readSqliteJsonRows } from './sqlite-reader';

type ZcodeTokens = {
  input?: number;
  output?: number;
  reasoning?: number;
  cache?: { read?: number; write?: number };
};

type ZcodeMessageData = {
  id?: string;
  role?: string;
  sessionID?: string;
  time?: { created?: number; completed?: number };
  modelID?: string;
  providerID?: string;
  tokens?: ZcodeTokens;
};

type ZcodeMessageRow = {
  id?: string;
  session_id?: string;
  time_updated?: number;
  data?: string;
};

function safeInt(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function epochToIso(value: number | undefined): string {
  if (!value || !Number.isFinite(value) || value <= 0) return new Date().toISOString();
  return new Date(value).toISOString();
}

function pushEvent(
  out: RawEvent[],
  model: string,
  kind: TokenKind,
  tokenCount: number,
  occurredAt: string
) {
  if (tokenCount <= 0) return;
  out.push({ source: 'zcode', model, kind, tokenCount, occurredAt });
}

/**
 * ZCode is the OpenCode-fork CLI from Z.ai (Zhipu AI). It stores assistant
 * messages in a SQLite database with the exact same `message` table schema
 * as OpenCode v1.2+.
 *
 *   Location: $ZCODE_HOME/cli/db/db.sqlite
 *             (defaults to ~/.zcode/cli/db/db.sqlite)
 *
 * The catch: ZCode can also orchestrate bundled claude-code / codex /
 * gemini-cli sub-agents. Those sub-agent turns carry providerID
 * "anthropic" / "openai" / "google" and write to ~/.claude / ~/.codex /
 * ~/.gemini — the standalone Claude/Codex/Gemini parsers already count
 * them. If we counted them again here, we'd double-count every multi-agent
 * session run inside ZCode.
 *
 * ZCode's OWN turns (its GLM models via Z.ai / BigModel) carry providerID
 * "builtin:zai-start-plan" / "builtin:bigmodel-coding-plan" / etc. Users
 * can also add CUSTOM providers that point at any model — those get a
 * random UUID as their providerID, so an allowlist of known vendor
 * keywords can NEVER match them and would silently drop every
 * custom-provider turn. Hence a blocklist (exclude anthropic / openai /
 * google), not an allowlist. We key off providerID, NEVER the model id —
 * a GLM/Claude model the user ran *inside* Claude Code is source=claude,
 * so matching the model name would re-count it.
 */
export class ZcodeProvider implements Provider {
  readonly id = 'zcode' as const;
  readonly displayName = 'ZCode (Z.ai)';

  private home: string;
  private env: NodeJS.ProcessEnv;

  constructor(home: string, env: NodeJS.ProcessEnv = process.env) {
    this.home = home;
    this.env = env;
  }

  private get dbPath(): string {
    const zcodeHome = this.env.ZCODE_HOME || join(this.home, '.zcode');
    return join(zcodeHome, 'cli', 'db', 'db.sqlite');
  }

  async listFiles(): Promise<string[]> {
    if (!existsSync(this.dbPath)) return [];
    // ZCode is SQLite-based, not file-based. Synthesize a single "virtual"
    // file path so the Provider interface stays uniform.
    return [`${this.dbPath}::table-message`];
  }

  async parseFile(
    _filePath: string,
    _prevCursor: FileCursor | null
  ): Promise<{ events: RawEvent[]; newCursor: FileCursor | null }> {
    const events: RawEvent[] = [];
    if (!existsSync(this.dbPath)) return { events, newCursor: null };

    // Pull every assistant message. We treat the table as the source of
    // truth — same wipe-then-refill semantics as Cursor, leaning on the
    // aggregator's replace-mode behavior to keep bucket totals consistent
    // across re-syncs.
    const sql = `SELECT id, session_id, time_updated, data FROM message WHERE json_extract(data, '$.role') = 'assistant' ORDER BY time_created ASC`;
    const rows = readSqliteJsonRows(this.dbPath, sql, { label: 'ZCode' });

    for (const row of rows as ZcodeMessageRow[]) {
      if (typeof row.data !== 'string') continue;
      let data: ZcodeMessageData;
      try {
        data = JSON.parse(row.data) as ZcodeMessageData;
      } catch {
        continue;
      }

      // Blocklist sub-agent providers that the standalone parsers already
      // count. See class docstring for the full reasoning.
      const provider = String(data.providerID ?? '').toLowerCase();
      if (
        provider.includes('anthropic') ||
        provider.includes('openai') ||
        provider.includes('google')
      ) {
        continue;
      }

      const tokens = data.tokens;
      if (!tokens || typeof tokens !== 'object') continue;
      const hasTokens =
        safeInt(tokens.input) > 0 ||
        safeInt(tokens.output) > 0 ||
        safeInt(tokens.reasoning) > 0;
      if (!hasTokens) continue;

      const model = data.modelID || 'unknown';
      const ts = epochToIso(data.time?.created);
      const input = safeInt(tokens.input);
      const output = safeInt(tokens.output);
      const reasoning = safeInt(tokens.reasoning);
      const cacheRead = safeInt(tokens.cache?.read);
      const cacheWrite = safeInt(tokens.cache?.write);

      // input = pure new input + cache write (billed as input by Anthropic /
      // OpenAI). cache.read stays separate so the game can track it.
      pushEvent(events, model, 'input', input + cacheWrite, ts);
      pushEvent(events, model, 'cached', cacheRead, ts);
      pushEvent(events, model, 'output', output, ts);
      pushEvent(events, model, 'reasoning', reasoning, ts);
    }

    return {
      events,
      newCursor: { inode: 0, offset: 0 }
    };
  }
}
