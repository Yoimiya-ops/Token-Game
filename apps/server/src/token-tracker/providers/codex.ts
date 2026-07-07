import type { Provider } from './base';
import type { FileCursor, RawEvent, TokenKind } from '../types';
import { readCompleteJsonlLinesFromOffset } from './jsonl-cursor';

type CodexTokenUsage = {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
  total_tokens?: number;
};

type CodexTokenCountInfo = {
  total_token_usage?: CodexTokenUsage;
  last_token_usage?: CodexTokenUsage;
};

type CodexLinePayload = {
  type?: string;
  model?: string;
  info?: CodexTokenCountInfo;
};

type CodexLine = {
  timestamp?: string;
  type?: string;
  payload?: CodexLinePayload;
};

function safeInt(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * Codex CLI / Codex Desktop rollout logs.
 *
 * Location: ~/.codex/sessions/YYYY/MM/DD/rollout-<timestamp>-<uuid>.jsonl
 *
 * Format: one JSON object per line, with a `type` discriminator.
 *   - `session_meta`     : session start; carries originator + model_provider
 *   - `turn_context`     : model context for the current turn (has `model` name)
 *   - `event_msg` payload.type === `token_count`:
 *       info.total_token_usage = cumulative across the session
 *       info.last_token_usage  = delta for the most recent API call
 *
 * We only need the `last_token_usage` deltas — emitting the cumulative
 * numbers would double-count on every sync. To know the model, we keep a
 * "most recent turn_context.model" pointer as we stream the file.
 */
export class CodexProvider implements Provider {
  readonly id = 'codex' as const;
  readonly displayName = 'Codex (OpenAI)';

  private home: string;

  constructor(home: string) {
    this.home = home;
  }

  async listFiles(): Promise<string[]> {
    const { readdir } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const root = join(this.home, '.codex', 'sessions');
    const out: string[] = [];
    await walkRolloutTree(root, out);
    out.sort();
    return out;
  }

  async parseFile(
    filePath: string,
    prevCursor: FileCursor | null
  ): Promise<{ events: RawEvent[]; newCursor: FileCursor | null }> {
    const events: RawEvent[] = [];
    const startOffset = prevCursor?.offset ?? 0;

    // Snapshot the file size first so we know how far we can read.
    // If the file shrank (log rotation), restart from 0.
    const { statSync } = await import('node:fs');
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

    // Read from the byte offset, keeping track of the most recent
    // model name seen in any turn_context line.
    const { lines, bytesRead } = readCompleteJsonlLinesFromOffset(filePath, startOffset);

    let lastModel = 'unknown';

    for (const { text: line } of lines) {
      if (!line.trim()) continue;

      let parsed: CodexLine;
      try {
        parsed = JSON.parse(line) as CodexLine;
      } catch {
        // Skip malformed line; advance cursor anyway.
        continue;
      }

      const payload = parsed.payload;
      if (!payload) continue;

      if (payload.model) {
        // turn_context or session_meta refresh — update the model pointer.
        lastModel = payload.model;
      }

      if (payload.type === 'token_count' && payload.info?.last_token_usage) {
        const ts = parsed.timestamp ?? new Date().toISOString();
        const last = payload.info.last_token_usage;
        const cached = safeInt(last.cached_input_tokens);
        const rawInput = safeInt(last.input_tokens);
        // Codex reports input_tokens as the total of the prompt including the
        // cached prefix. Subtract cached to get "new input" — matches what the
        // existing token-tracker.ts does for queue normalization.
        const input = Math.max(0, rawInput - cached);
        const output = safeInt(last.output_tokens);
        const reasoning = safeInt(last.reasoning_output_tokens);
        pushEvent(events, 'codex', lastModel, 'cached', cached, ts);
        pushEvent(events, 'codex', lastModel, 'input', input, ts);
        pushEvent(events, 'codex', lastModel, 'output', output, ts);
        pushEvent(events, 'codex', lastModel, 'reasoning', reasoning, ts);
      }
    }

    return {
      events,
      newCursor: { inode: prevCursor?.inode ?? 0, offset: startOffset + bytesRead }
    };
  }
}

function pushEvent(
  out: RawEvent[],
  source: RawEvent['source'],
  model: string,
  kind: TokenKind,
  tokenCount: number,
  occurredAt: string
) {
  if (tokenCount <= 0) return;
  out.push({ source, model, kind, tokenCount, occurredAt });
}

/**
 * Walk ~/.codex/sessions/YYYY/MM/DD/*.jsonl, accepting any depth. Codex-Manager
 * archives to ~/.codex/archived_sessions/ flat — we keep the walker generic so
 * one provider can scan both layouts.
 */
async function walkRolloutTree(root: string, out: string[]): Promise<void> {
  const { readdir, stat } = await import('node:fs/promises');
  const { join } = await import('node:path');
  let entries: import('node:fs').Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const p = join(root, entry.name);
    if (entry.isDirectory()) {
      await walkRolloutTree(p, out);
    } else if (entry.isFile() && entry.name.startsWith('rollout-') && entry.name.endsWith('.jsonl')) {
      // Defensive: stat to skip symlinks pointing nowhere.
      try {
        await stat(p);
        out.push(p);
      } catch {
        // ignore
      }
    }
  }
}
