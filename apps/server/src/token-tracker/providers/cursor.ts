import { existsSync, readFileSync } from 'node:fs';
import { basename, join, sep } from 'node:path';
import https from 'node:https';
import { URL } from 'node:url';
import type { Provider } from './base';
import type { FileCursor, RawEvent, TokenKind } from '../types';
import { readSqliteFirstValue, readSqliteJsonRows } from './sqlite-reader';

/**
 * Cursor lives at three different paths depending on OS. The state DB holds
 * the JWT we use to authenticate against cursor.com's CSV export.
 */
function resolveCursorPaths(home: string, platform: NodeJS.Platform, env: NodeJS.ProcessEnv) {
  let appDir: string;
  if (platform === 'darwin') {
    appDir = join(home, 'Library', 'Application Support', 'Cursor');
  } else if (platform === 'win32') {
    const appData = (typeof env.APPDATA === 'string' && env.APPDATA.trim()) || join(home, 'AppData', 'Roaming');
    appDir = join(appData, 'Cursor');
  } else {
    const xdg = (typeof env.XDG_CONFIG_HOME === 'string' && env.XDG_CONFIG_HOME.trim()) || join(home, '.config');
    appDir = join(xdg, 'Cursor');
  }
  return {
    appDir,
    stateDbPath: join(appDir, 'User', 'globalStorage', 'state.vscdb'),
    cliConfigPath: join(home, '.cursor', 'cli-config.json')
  };
}

const CURSOR_CSV_URL =
  'https://cursor.com/api/dashboard/export-usage-events-csv?strategy=tokens';
const CURSOR_AUTH_TOKEN_SQL = "SELECT value FROM ItemTable WHERE key = 'cursorAuth/accessToken';";

// WorkOS OAuth subject prefixes Cursor accepts as-is in the session cookie.
// The native Cursor flow is "auth0|user_XXXXX" → we keep just the user part;
// for Google/GitHub/OIDC-bridged sign-ins the full "<provider>|<id>" works
// verbatim against cursor.com.
const WORKOS_SUBJECT_RE = /^(google-oauth2|github|oidc|auth0)\|[^|]+$/;

function normalizeCursorSubject(subject: string | null | undefined): string | null {
  if (!subject) return null;
  const native = subject.match(/\|(user_[A-Za-z0-9_]+)$/);
  if (native) return native[1];
  if (WORKOS_SUBJECT_RE.test(subject)) return subject;
  return null;
}

function extractUserIdFromCliConfig(configPath: string): string | null {
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as { authInfo?: { authId?: string } };
    return normalizeCursorSubject(config?.authInfo?.authId ?? '');
  } catch {
    return null;
  }
}

function extractUserIdFromJwt(jwt: string): string | null {
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as { sub?: string };
    return normalizeCursorSubject(payload.sub ?? '');
  } catch {
    return null;
  }
}

function extractCursorSessionToken(stateDbPath: string, cliConfigPath: string): string | null {
  if (!existsSync(stateDbPath)) return null;
  const jwt = readSqliteFirstValue(stateDbPath, CURSOR_AUTH_TOKEN_SQL, 'value', { label: 'Cursor' });
  if (!jwt || jwt.length < 10) return null;
  const userId = extractUserIdFromCliConfig(cliConfigPath) || extractUserIdFromJwt(jwt);
  if (!userId) return null;
  return `WorkosCursorSessionToken=${userId}%3A%3A${jwt}`;
}

function fetchCursorCsv(cookie: string, timeoutMs = 30_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = new URL(CURSOR_CSV_URL);
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: 'GET',
        headers: {
          Accept: '*/*',
          Cookie: cookie,
          Referer: 'https://www.cursor.com/settings',
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        timeout: timeoutMs
      },
      (res) => {
        if (res.statusCode === 401 || res.statusCode === 403) {
          res.resume();
          return reject(new Error('Cursor session expired — re-login in Cursor to refresh'));
        }
        if (res.statusCode === 308 || res.statusCode === 301 || res.statusCode === 302) {
          const location = res.headers.location;
          res.resume();
          if (!location) return reject(new Error('Cursor API redirect without Location header'));
          return fetchCursorCsvAt(location, cookie, timeoutMs).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`Cursor API returned ${res.statusCode}`));
        }
        let data = '';
        res.on('data', (chunk: Buffer) => {
          data += chunk.toString('utf8');
        });
        res.on('end', () => resolve(data));
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Cursor API request timed out'));
    });
    req.end();
  });
}

function fetchCursorCsvAt(urlStr: string, cookie: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: 'GET',
        headers: {
          Accept: '*/*',
          Cookie: cookie,
          Referer: 'https://www.cursor.com/settings',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
        },
        timeout: timeoutMs
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`Cursor API returned ${res.statusCode} from ${urlStr}`));
        }
        let data = '';
        res.on('data', (chunk: Buffer) => {
          data += chunk.toString('utf8');
        });
        res.on('end', () => resolve(data));
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Cursor API request timed out'));
    });
    req.end();
  });
}

// ── CSV parser ────────────────────────────────────────────────────────────

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
    } else if (ch === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

function stripQuotes(s: string | undefined): string {
  if (!s) return '';
  const t = s.trim();
  if (t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1);
  return t;
}

function toNum(s: string | undefined): number {
  const n = Number(stripQuotes(s));
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

type CursorCsvRecord = {
  date: string;
  model: string;
  inputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  totalTokens: number;
};

function parseCursorCsv(csvText: string): CursorCsvRecord[] {
  const lines = csvText.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const headerFields = parseCsvLine(lines[0]).map(stripQuotes);
  const columnIndex = new Map<string, number>();
  for (let i = 0; i < headerFields.length; i++) {
    columnIndex.set(headerFields[i], i);
  }

  const dateIdx = columnIndex.get('Date');
  const modelIdx = columnIndex.get('Model');
  const inputWithIdx = columnIndex.get('Input (w/ Cache Write)');
  const inputWithoutIdx = columnIndex.get('Input (w/o Cache Write)');
  const cacheReadIdx = columnIndex.get('Cache Read');
  const outputIdx = columnIndex.get('Output Tokens');
  const totalIdx = columnIndex.get('Total Tokens');

  const required = [dateIdx, modelIdx, inputWithIdx, inputWithoutIdx, cacheReadIdx, outputIdx, totalIdx];
  if (required.some((idx) => idx === undefined)) return [];
  const minFields = Math.max(...(required as number[])) + 1;

  const out: CursorCsvRecord[] = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);
    if (!fields || fields.length < minFields) continue;
    const inputWithCache = toNum(fields[inputWithIdx!]);
    const inputWithoutCache = toNum(fields[inputWithoutIdx!]);
    const record: CursorCsvRecord = {
      date: stripQuotes(fields[dateIdx!]),
      model: stripQuotes(fields[modelIdx!]),
      inputTokens: inputWithoutCache,
      cacheWriteTokens: Math.max(0, inputWithCache - inputWithoutCache),
      cacheReadTokens: toNum(fields[cacheReadIdx!]),
      outputTokens: toNum(fields[outputIdx!]),
      totalTokens: toNum(fields[totalIdx!])
    };
    if (record.totalTokens <= 0 && record.inputTokens <= 0 && record.outputTokens <= 0) continue;
    out.push(record);
  }
  return out;
}

function pushEvent(
  out: RawEvent[],
  model: string,
  kind: TokenKind,
  tokenCount: number,
  occurredAt: string
) {
  if (tokenCount <= 0) return;
  out.push({ source: 'cursor', model, kind, tokenCount, occurredAt });
}

/**
 * Cursor (the AI editor). Data lives in two places:
 *   - Local SQLite at <app>/User/globalStorage/state.vscdb  → cursorAuth/accessToken JWT
 *   - Remote: https://cursor.com/api/dashboard/export-usage-events-csv?strategy=tokens
 *
 * The CSV is an account-level API export, not an append-only local log. Each
 * row is one billed "round-trip" and carries `Input (w/ Cache Write)`,
 * `Input (w/o Cache Write)`, `Cache Read`, `Output Tokens`, `Total Tokens`,
 * `Model`, `Date`. We split input into "pure new input" + "cache write",
 * and emit a RawEvent per kind. Because our aggregator is replace-mode
 * (not append-mode) at the bucket level, re-running the same CSV produces
 * the same buckets — no double-counting on re-sync.
 *
 * Failure modes this provider must tolerate:
 *   - Cursor not installed at all → return []
 *   - User not logged in to Cursor → cookie extraction returns null
 *   - Session expired (401/403) → log via stderr, return []
 *   - No internet → log via stderr, return []
 *   - Missing sqlite3 CLI and Node < 22 → log via stderr, return []
 */
export class CursorProvider implements Provider {
  readonly id = 'cursor' as const;
  readonly displayName = 'Cursor';

  private home: string;
  private env: NodeJS.ProcessEnv;
  private platform: NodeJS.Platform;
  private paths: { appDir: string; stateDbPath: string; cliConfigPath: string };

  constructor(home: string, env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform) {
    this.home = home;
    this.env = env;
    this.platform = platform;
    this.paths = resolveCursorPaths(home, platform, env);
  }

  async listFiles(): Promise<string[]> {
    // Cursor is API-based, not file-based. We synthesize a single "virtual"
    // file path so the Provider interface stays uniform. parseFile() will
    // ignore the path and call the API directly.
    if (!existsSync(this.paths.appDir)) return [];
    return [`${this.paths.appDir}::csv-export`];
  }

  async parseFile(
    _filePath: string,
    _prevCursor: FileCursor | null
  ): Promise<{ events: RawEvent[]; newCursor: FileCursor | null }> {
    const events: RawEvent[] = [];

    let cookie: string | null = null;
    try {
      cookie = extractCursorSessionToken(this.paths.stateDbPath, this.paths.cliConfigPath);
    } catch (error) {
      process.stderr.write(`[token-game] Cursor auth extraction failed: ${(error as Error).message}\n`);
      return { events, newCursor: null };
    }
    if (!cookie) {
      // No token → user is either not logged in or sqlite reader is unavailable.
      // We don't spam stderr here because this is the common case for users
      // who don't use Cursor; warnSqliteUnavailable in sqlite-reader.ts handles
      // the "we genuinely can't read" case.
      return { events, newCursor: null };
    }

    let csv: string;
    try {
      csv = await fetchCursorCsv(cookie);
    } catch (error) {
      process.stderr.write(`[token-game] Cursor API sync failed: ${(error as Error).message}\n`);
      return { events, newCursor: null };
    }

    const records = parseCursorCsv(csv);
    for (const record of records) {
      if (!record.date) continue;
      const ts = record.date;
      // cache_creation_input_tokens is folded into input by our aggregator's
      // input field, but here we want clean separation: input = pure new,
      // cached = cache reads, cache writes get pushed as input (Anthropic /
      // OpenAI both bill cache writes as input tokens).
      pushEvent(events, record.model || 'unknown', 'input', record.inputTokens + record.cacheWriteTokens, ts);
      pushEvent(events, record.model || 'unknown', 'cached', record.cacheReadTokens, ts);
      pushEvent(events, record.model || 'unknown', 'output', record.outputTokens, ts);
    }

    return {
      events,
      newCursor: { inode: 0, offset: 0, seenIds: [] }
    };
  }
}
