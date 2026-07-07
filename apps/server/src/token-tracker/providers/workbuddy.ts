import { readFileSync, statSync, existsSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Provider } from './base';
import type { FileCursor, RawEvent, TokenKind } from '../types';
import { readCompleteJsonlLinesFromOffset } from './jsonl-cursor';

type WorkbuddyPromptDetails = { cached_tokens?: number };
type WorkbuddyCompletionDetails = { reasoning_tokens?: number };

type WorkbuddyRawUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: WorkbuddyPromptDetails;
  completion_tokens_details?: WorkbuddyCompletionDetails;
  cache_read_input_tokens?: number;
  prompt_cache_hit_tokens?: number;
  cache_creation_input_tokens?: number;
};

type WorkbuddyProviderData = {
  rawUsage?: WorkbuddyRawUsage;
  model?: string;
  requestModelId?: string;
  messageId?: string;
};

type WorkbuddyLine = {
  id?: string;
  sessionId?: string;
  timestamp?: number;
  model?: string;
  providerData?: WorkbuddyProviderData;
};

function safeInt(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function pushEvent(
  out: RawEvent[],
  model: string,
  kind: TokenKind,
  tokenCount: number,
  occurredAt: string
) {
  if (tokenCount <= 0) return;
  out.push({ source: 'workbuddy', model, kind, tokenCount, occurredAt });
}

function resolveDefaultModel(workbuddyHome: string): string {
  const fallback = 'auto';
  try {
    const raw = readFileSync(join(workbuddyHome, 'settings.json'), 'utf8');
    const parsed = JSON.parse(raw) as { model?: unknown };
    if (parsed && typeof parsed === 'object' && typeof parsed.model === 'string' && parsed.model.trim()) {
      return parsed.model.trim();
    }
  } catch {
    // settings missing or malformed — fall through
  }
  return fallback;
}

/**
 * Tencent WorkBuddy — Claude Code fork with auto-routing.
 *
 * Location: $WORKBUDDY_HOME/projects/<workspace>/<session>.jsonl  (recursive)
 *           (defaults to ~/.workbuddy/projects/...)
 *
 * Format: standard Claude Code-like JSONL. Per-round-trip usage rides on
 * any record with `providerData.rawUsage` (assistant messages AND
 * function_call records both carry it). Sub-agent logs live in
 * nested `subagents/agent-<id>.jsonl` files — the recursive walk picks
 * them up automatically. We dedup on the response id (or messageId /
 * session+ts as fallbacks) per file.
 *
 * Model is read from `~/.workbuddy/settings.json` once as a fallback; the
 * per-event `providerData.model` / `providerData.requestModelId` always
 * wins when present.
 */
export class WorkBuddyProvider implements Provider {
  readonly id = 'workbuddy' as const;
  readonly displayName = 'WorkBuddy';

  private home: string;
  private env: NodeJS.ProcessEnv;
  private defaultModel: string;

  constructor(home: string, env: NodeJS.ProcessEnv = process.env) {
    this.home = home;
    this.env = env;
    this.defaultModel = resolveDefaultModel(env.WORKBUDDY_HOME || join(home, '.workbuddy'));
  }

  async listFiles(): Promise<string[]> {
    const workbuddyHome = this.env.WORKBUDDY_HOME || join(this.home, '.workbuddy');
    const projectsDir = join(workbuddyHome, 'projects');
    if (!existsSync(projectsDir)) return [];
    const out: string[] = [];
    const walk = (dir: string) => {
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = join(dir, entry.name);
        let isDir = entry.isDirectory();
        let isFile = entry.isFile();
        // Dirent flags are false for symlinks — stat defensively.
        if (!isDir && !isFile) {
          try {
            const st = statSync(full);
            isDir = st.isDirectory();
            isFile = st.isFile();
          } catch {
            continue;
          }
        }
        if (isDir) walk(full);
        else if (isFile && entry.name.endsWith('.jsonl')) out.push(full);
      }
    };
    walk(projectsDir);
    out.sort();
    return out;
  }

  async parseFile(
    filePath: string,
    prevCursor: FileCursor | null
  ): Promise<{ events: RawEvent[]; newCursor: FileCursor | null }> {
    const events: RawEvent[] = [];
    const startOffset = prevCursor?.offset ?? 0;

    let totalSize: number;
    try {
      totalSize = statSync(filePath).size;
    } catch {
      return { events: [], newCursor: prevCursor };
    }
    if (totalSize < startOffset) {
      return { events: [], newCursor: { ...(prevCursor ?? { inode: 0, offset: 0 }), offset: 0 } };
    }
    if (totalSize === startOffset) {
      return { events, newCursor: prevCursor };
    }

    const { lines, bytesRead } = readCompleteJsonlLinesFromOffset(filePath, startOffset);

    const seenIds = new Set<string>(prevCursor?.seenIds ?? []);

    for (const { text: line } of lines) {
      if (!line.trim()) continue;

      let parsed: WorkbuddyLine;
      try {
        parsed = JSON.parse(line) as WorkbuddyLine;
      } catch {
        continue;
      }

      const provider: WorkbuddyProviderData | undefined = parsed.providerData;
      const rawUsage = provider && typeof provider === 'object' ? provider.rawUsage : null;
      if (!rawUsage || typeof rawUsage !== 'object' || !provider) continue;

      const sessionId =
        typeof parsed.sessionId === 'string' && parsed.sessionId
          ? parsed.sessionId
          : basename(filePath, '.jsonl');
      const tsMs =
        Number.isFinite(Number(parsed.timestamp)) && Number(parsed.timestamp) > 0
          ? Number(parsed.timestamp)
          : null;
      // Stable dedup key: response id → provider messageId → session+ts.
      const messageId =
        (typeof parsed.id === 'string' && parsed.id
          ? parsed.id
          : typeof provider.messageId === 'string' && provider.messageId
            ? provider.messageId
            : tsMs != null
              ? `${sessionId}:${tsMs}`
              : null);
      if (!messageId) continue;
      if (seenIds.has(messageId)) continue;
      seenIds.add(messageId);

      const promptTokens = safeInt(rawUsage.prompt_tokens);
      const completionTokens = safeInt(rawUsage.completion_tokens);
      const promptDetails = rawUsage.prompt_tokens_details ?? {};
      const completionDetails = rawUsage.completion_tokens_details ?? {};

      // Cache reads are mirrored across up to three fields depending on which
      // upstream the auto-router used; take the largest non-zero mirror.
      const cacheRead = Math.max(
        safeInt(rawUsage.cache_read_input_tokens),
        safeInt(promptDetails.cached_tokens),
        safeInt(rawUsage.prompt_cache_hit_tokens)
      );
      const cacheCreation = safeInt(rawUsage.cache_creation_input_tokens);
      // prompt_tokens is the FULL prompt; subtract BOTH reads and writes so
      // input_tokens is pure non-cached input (no double-counting cache writes).
      const inputTokens = Math.max(0, promptTokens - cacheRead - cacheCreation);
      // completion_tokens INCLUDES reasoning (verified: total == prompt+completion).
      const reasoningTokens = Math.min(completionTokens, safeInt(completionDetails.reasoning_tokens));
      const outputTokens = Math.max(0, completionTokens - reasoningTokens);

      if (
        inputTokens === 0 &&
        outputTokens === 0 &&
        cacheRead === 0 &&
        cacheCreation === 0 &&
        reasoningTokens === 0
      ) {
        continue;
      }
      if (tsMs == null) continue;
      const ts = new Date(tsMs).toISOString();

      const model =
        provider.model ||
        provider.requestModelId ||
        parsed.model ||
        this.defaultModel;

      pushEvent(events, model, 'input', inputTokens, ts);
      pushEvent(events, model, 'cached', cacheRead, ts);
      pushEvent(events, model, 'output', outputTokens, ts);
      pushEvent(events, model, 'reasoning', reasoningTokens, ts);
    }

    // Cap dedup set to last 10k IDs to bound cursor state size.
    const seenArr = Array.from(seenIds);
    const capped = seenArr.length > 10_000 ? seenArr.slice(seenArr.length - 10_000) : seenArr;

    return {
      events,
      newCursor: {
        inode: prevCursor?.inode ?? 0,
        offset: startOffset + bytesRead,
        seenIds: capped
      }
    };
  }
}
