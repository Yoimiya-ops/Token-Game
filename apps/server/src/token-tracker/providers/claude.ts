import { statSync } from 'node:fs';
import { join } from 'node:path';
import { readdir } from 'node:fs/promises';
import type { Provider } from './base';
import type { FileCursor, RawEvent, TokenKind } from '../types';
import { readCompleteJsonlLinesFromOffset } from './jsonl-cursor';

type ClaudeUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
};

type ClaudeMessage = {
  role?: string;
  model?: string;
  usage?: ClaudeUsage;
};

type ClaudeLine = {
  type?: string;
  message?: ClaudeMessage;
  timestamp?: string;
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
  out.push({ source: 'claude', model, kind, tokenCount, occurredAt });
}

/**
 * Claude Code session logs.
 *
 * Location: ~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl
 *
 * Format: one JSON object per line. The relevant lines are `assistant` rows
 * which carry `message.usage` with these fields:
 *   - input_tokens                  (new prompt input, excluding cache)
 *   - cache_creation_input_tokens   (cache writes — count as input)
 *   - cache_read_input_tokens       (cache reads — count as cached)
 *   - output_tokens
 *
 * We treat cache_creation as input so the game's `input` bucket reflects the
 * total "real input" bill, matching how OpenAI / Anthropic bill it.
 */
export class ClaudeCodeProvider implements Provider {
  readonly id = 'claude' as const;
  readonly displayName = 'Claude Code';

  private home: string;

  constructor(home: string) {
    this.home = home;
  }

  async listFiles(): Promise<string[]> {
    const root = join(this.home, '.claude', 'projects');
    const out: string[] = [];
    await walkClaudeProjectTree(root, out);
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

    let lastModel = 'unknown';

    for (const { text: line } of lines) {
      if (!line.trim()) continue;

      let parsed: ClaudeLine;
      try {
        parsed = JSON.parse(line) as ClaudeLine;
      } catch {
        continue;
      }

      if (parsed.type !== 'assistant') continue;
      const message = parsed.message;
      if (!message) continue;
      if (message.model) {
        lastModel = message.model;
      }
      const usage = message.usage;
      if (!usage) continue;

      const ts = parsed.timestamp ?? new Date().toISOString();
      const cacheWrite = safeInt(usage.cache_creation_input_tokens);
      const cacheRead = safeInt(usage.cache_read_input_tokens);
      const inputRaw = safeInt(usage.input_tokens);
      // Anthropic reports input_tokens excluding cache; we add cache_write
      // (which the provider charges as input) and track cache_read as cached.
      const input = inputRaw + cacheWrite;
      const output = safeInt(usage.output_tokens);

      pushEvent(events, lastModel, 'input', input, ts);
      pushEvent(events, lastModel, 'cached', cacheRead, ts);
      pushEvent(events, lastModel, 'output', output, ts);
    }

    return {
      events,
      newCursor: { inode: prevCursor?.inode ?? 0, offset: startOffset + bytesRead }
    };
  }
}

async function walkClaudeProjectTree(root: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const p = join(root, entry.name);
    if (entry.isDirectory()) {
      await walkClaudeProjectTree(p, out);
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      // Skip sub-agent transcripts if we can identify them by path component.
      // Sub-agent files live under <session>/subagents/, but their token
      // counts are already part of the parent's assistant messages, so we
      // include all .jsonl files in projects/.
      out.push(p);
    }
  }
}
