/**
 * Tiny SQLite reader used by providers that need to peek at AI CLIs' local
 * databases (currently: Cursor's auth token). Two backends, no native deps:
 *
 *   1. The system `sqlite3` CLI (preferred — well-tested, handles WAL files
 *      and locked DBs gracefully).
 *   2. Node.js 22+ built-in `node:sqlite` (fallback when the CLI is absent
 *      — common on fresh Windows installs).
 *
 * Both backends are read-only and return JSON rows, so call sites never have
 * to care which one fired. The first backend that succeeds wins; we don't
 * try the other when one works.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const warnedFailures = new Set<string>();

function isDebugEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = String(env.TOKENTRACKER_DEBUG ?? '').toLowerCase();
  return value === '1' || value === 'true';
}

function formatError(err: unknown): string {
  if (!err) return 'unknown error';
  return err instanceof Error ? err.message : String(err);
}

function isSqliteCliUnavailable(err: unknown): boolean {
  const message = formatError(err).toLowerCase();
  return (
    (err as { code?: string })?.code === 'ENOENT' ||
    message.includes('spawn sqlite3 enoent') ||
    message.includes('sqlite3 enoent') ||
    message.includes('not recognized as an internal or external command')
  );
}

function isNodeSqliteUnavailable(err: unknown): boolean {
  const message = formatError(err).toLowerCase();
  return (
    message.includes('no such built-in module') ||
    message.includes("cannot find module 'node:sqlite'") ||
    message.includes('cannot find module "node:sqlite"') ||
    message.includes('node:sqlite databasesync is unavailable')
  );
}

function warnUnavailable(label: string, dbPath: string, cliError: unknown, nodeSqliteError: unknown, env: NodeJS.ProcessEnv) {
  const key = `${label}:${dbPath}`;
  if (warnedFailures.has(key)) return;
  warnedFailures.add(key);
  process.stderr.write(
    `[token-game] Cannot read ${label} SQLite database. Install the sqlite3 CLI on PATH, or use Node 22+ with node:sqlite. Path: ${dbPath}\n`
  );
  if (isDebugEnabled(env)) {
    process.stderr.write(`[token-game] sqlite3 CLI failed: ${formatError(cliError)}\n`);
    process.stderr.write(`[token-game] node:sqlite failed: ${formatError(nodeSqliteError)}\n`);
  }
}

function readSqliteRowsWithCli(dbPath: string, sql: string): unknown[] {
  const raw = execFileSync('sqlite3', ['-json', dbPath, sql], {
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
    timeout: 30_000,
    stdio: ['pipe', 'pipe', 'pipe']
  });
  if (!raw || !raw.trim()) return [];
  const rows: unknown = JSON.parse(raw);
  return Array.isArray(rows) ? rows : [];
}

function readSqliteRowsWithNode(dbPath: string, sql: string): unknown[] {
  const requireFn = createRequire(import.meta.url);
  const sqlite = requireFn('node:sqlite') as { DatabaseSync?: new (path: string, opts?: { readOnly?: boolean }) => { prepare: (sql: string) => { all: () => unknown[] }; close: () => void } };
  if (typeof sqlite.DatabaseSync !== 'function') {
    throw new Error('node:sqlite DatabaseSync is unavailable');
  }
  const db = new sqlite.DatabaseSync(dbPath, { readOnly: true });
  try {
    const rows = db.prepare(sql).all();
    return Array.isArray(rows) ? rows : [];
  } finally {
    db.close();
  }
}

export type SqliteReadOptions = {
  label?: string;
  env?: NodeJS.ProcessEnv;
};

/**
 * Run a SELECT and return every row as a plain object. Empty array on any
 * failure (DB missing, no backend available, query error) — call sites should
 * always treat absence as "we don't know" rather than throwing.
 */
export function readSqliteJsonRows(dbPath: string, sql: string, options: SqliteReadOptions = {}): Record<string, unknown>[] {
  if (!dbPath || !sql) return [];
  try {
    if (!existsSync(dbPath)) return [];
  } catch {
    return [];
  }

  const label = options.label ?? 'local';
  const env = options.env ?? process.env;

  let cliError: unknown = null;
  try {
    return readSqliteRowsWithCli(dbPath, sql) as Record<string, unknown>[];
  } catch (err) {
    cliError = err;
  }

  let nodeSqliteError: unknown = null;
  try {
    return readSqliteRowsWithNode(dbPath, sql) as Record<string, unknown>[];
  } catch (err) {
    nodeSqliteError = err;
  }

  if (isSqliteCliUnavailable(cliError) && isNodeSqliteUnavailable(nodeSqliteError)) {
    warnUnavailable(label, dbPath, cliError, nodeSqliteError, env);
  }
  return [];
}

/**
 * Convenience helper: read one column from the first row. Returns null when
 * the query is empty or the column is missing — never throws.
 */
export function readSqliteFirstValue(dbPath: string, sql: string, column: string, options: SqliteReadOptions = {}): string | null {
  const rows = readSqliteJsonRows(dbPath, sql, options);
  const first = rows[0];
  if (!first || typeof first !== 'object') return null;
  const value = (first as Record<string, unknown>)[column];
  if (value == null) return null;
  return typeof value === 'string' ? value.trim() : String(value).trim();
}

/**
 * Test-only: clear the warn-once cache so each test can trigger a fresh
 * warning if needed.
 */
export function resetSqliteWarningsForTest(): void {
  warnedFailures.clear();
}
