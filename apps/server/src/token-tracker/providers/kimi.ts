import { readFileSync, statSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Provider } from './base';
import type { FileCursor, RawEvent, TokenKind } from '../types';
import { readCompleteJsonlLinesFromOffset } from './jsonl-cursor';

type KimiCodeUsage = {
  // proto 0.6+ (camelCase)
  inputOther?: number;
  inputCacheRead?: number;
  inputCacheCreation?: number;
  output?: number;
  // older Anthropic-style
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  input_tokens_details?: { cached_tokens?: number };
};

type KimiCodeStepEnd = {
  type?: string;
  uuid?: string;
  time?: number;
  usage?: KimiCodeUsage;
};

type KimiCodeConfigUpdate = {
  type?: string;
  modelAlias?: string;
};

type KimiCodeContextLoopEvent = {
  type?: string;
  event?: KimiCodeStepEnd;
};

type KimiCodeLine = {
  type?: string;
  time?: number;
  modelAlias?: string;
  event?: KimiCodeStepEnd;
  // Older layout: top-level step.end (no context wrapper)
  usage?: KimiCodeUsage;
  uuid?: string;
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
  out.push({ source: 'kimi-code', model, kind, tokenCount, occurredAt });
}

function kimiCodeModelAlias(value: string | undefined): string | null {
  if (!value || typeof value !== 'string') return null;
  if (!value.trim()) return null;
  return value.includes('/') ? (value.split('/').pop() ?? value) : value;
}

function resolveDefaultModel(kimiCodeHome: string): string {
  const fallback = 'kimi-for-coding';
  try {
    const raw = readFileSync(join(kimiCodeHome, 'config.toml'), 'utf8');
    const m = raw.match(/^\s*default_model\s*=\s*"([^"]+)"/m);
    if (!m || !m[1]) return fallback;
    return m[1].includes('/') ? (m[1].split('/').pop() ?? m[1]) : m[1];
  } catch {
    return fallback;
  }
}

/**
 * Moonshot Kimi Code (official @moonshot-ai/kimi-code CLI).
 *
 * Location: $KIMI_CODE_HOME/sessions/<wd_dir_hash>/<session_id>/agents/<name>/wire.jsonl
 *           (defaults to ~/.kimi-code/sessions/..., recursive walk up to depth 5)
 *
 * Format: one JSON object per line. Three shapes we care about:
 *   - `config.update`           : declares the per-session model via `modelAlias`
 *   - `context.append_loop_event` wrapping `event.type == "step.end"`:
 *                                  carries per-step usage in `event.usage`
 *   - top-level `step.end` (older layout): same usage object at the top level
 *
 * The `step.end` event payload (and `usage.record` if present) are the SAME
 * object — we read only step.end to avoid double-counting.
 *
 * Two usage shapes coexist across Kimi Code versions:
 *   - proto 0.6.0+ (current): camelCase `{ inputOther, inputCacheRead,
 *     inputCacheCreation, output }`. `inputOther` is already non-cached.
 *   - Anthropic-style (older): `{ input_tokens, output_tokens,
 *     cache_read_input_tokens, cache_creation_input_tokens }`. OpenAI-compat
 *     models fold cache reads into `input_tokens` and expose them via
 *     `input_tokens_details.cached_tokens` — subtract so we never double-count.
 *
 * Model resolution: the `config.update` event's `modelAlias` sets the model
 * for that session and is cached on the cursor (so incremental resumes
 * starting past that line still know which model to attribute tokens to).
 */
export class KimiCodeProvider implements Provider {
  readonly id = 'kimi-code' as const;
  readonly displayName = 'Kimi Code (Moonshot)';

  private home: string;
  private env: NodeJS.ProcessEnv;
  private defaultModel: string;

  constructor(home: string, env: NodeJS.ProcessEnv = process.env) {
    this.home = home;
    this.env = env;
    this.defaultModel = resolveDefaultModel(env.KIMI_CODE_HOME || join(home, '.kimi-code'));
  }

  async listFiles(): Promise<string[]> {
    const kimiCodeHome = this.env.KIMI_CODE_HOME || join(this.home, '.kimi-code');
    const sessionsDir = join(kimiCodeHome, 'sessions');
    if (!existsSync(sessionsDir)) return [];
    const out: string[] = [];
    const walk = (dir: string, depth: number) => {
      if (depth > 5) return;
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full, depth + 1);
        } else if (entry.isFile() && entry.name === 'wire.jsonl') {
          out.push(full);
        }
      }
    };
    walk(sessionsDir, 0);
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
    // Per-file model is set by the nearest preceding config.update event and
    // cached on the cursor so incremental resumes (which start past that line)
    // keep attributing tokens to the right model.
    let fileModel = (typeof prevCursor?.model === 'string' && prevCursor.model) || this.defaultModel;

    for (const { text: line } of lines) {
      if (!line.trim()) continue;

      let parsed: KimiCodeLine;
      try {
        parsed = JSON.parse(line) as KimiCodeLine;
      } catch {
        continue;
      }

      if (parsed.type === 'config.update') {
        const alias = kimiCodeModelAlias(parsed.modelAlias);
        if (alias) fileModel = alias;
        continue;
      }

      // Resolve the actual step.end payload — newer layout wraps it in
      // context.append_loop_event, older layout is top-level.
      const evt: KimiCodeStepEnd | undefined =
        parsed.type === 'context.append_loop_event' && parsed.event && typeof parsed.event === 'object'
          ? parsed.event
          : parsed.type === 'step.end'
            ? (parsed as KimiCodeStepEnd)
            : undefined;
      if (!evt || evt.type !== 'step.end') continue;
      const usage = evt.usage;
      if (!usage || typeof usage !== 'object') continue;
      const id = evt.uuid;
      if (!id || seenIds.has(id)) continue;

      // Two usage shapes — see class docstring for the why.
      let cacheCreation = 0;
      let cacheRead = 0;
      let input = 0;
      let output = 0;
      if (usage.inputOther != null) {
        input = safeInt(usage.inputOther);
        cacheRead = safeInt(usage.inputCacheRead);
        cacheCreation = safeInt(usage.inputCacheCreation);
        output = safeInt(usage.output);
      } else {
        cacheCreation = safeInt(usage.cache_creation_input_tokens);
        if (usage.cache_read_input_tokens != null) {
          cacheRead = safeInt(usage.cache_read_input_tokens);
          input = safeInt(usage.input_tokens);
        } else {
          const details = usage.input_tokens_details ?? null;
          const cached = safeInt(details?.cached_tokens);
          cacheRead = cached;
          input = Math.max(0, safeInt(usage.input_tokens) - cached);
        }
        output = safeInt(usage.output_tokens);
      }
      if (input === 0 && output === 0 && cacheRead === 0 && cacheCreation === 0) {
        seenIds.add(id);
        continue;
      }

      const ms = parsed.time ?? evt.time;
      if (ms == null || !Number.isFinite(Number(ms))) continue;
      const ts = new Date(Number(ms)).toISOString();

      seenIds.add(id);
      // input_other is the non-cached input. cache_creation is the cache write
      // (billed as input by Anthropic/OpenAI), so we fold it in.
      pushEvent(events, fileModel, 'input', input + cacheCreation, ts);
      pushEvent(events, fileModel, 'cached', cacheRead, ts);
      pushEvent(events, fileModel, 'output', output, ts);
    }

    const seenArr = Array.from(seenIds);
    const capped = seenArr.length > 10_000 ? seenArr.slice(seenArr.length - 10_000) : seenArr;

    return {
      events,
      newCursor: {
        inode: prevCursor?.inode ?? 0,
        offset: startOffset + bytesRead,
        seenIds: capped,
        model: fileModel
      }
    };
  }
}
