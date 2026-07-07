import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import type { TrackerState, SourceId, ProviderState, FileCursor } from './types';

const STATE_VERSION = 1 as const;

function emptyState(): TrackerState {
  return {
    version: STATE_VERSION,
    providers: {},
    updatedAt: null,
    firstSyncAt: null
  };
}

/**
 * Read the tracker state file. Returns a fresh empty state if the file is
 * missing, unreadable, or has an unrecognized shape.
 */
export function readTrackerState(statePath: string): TrackerState {
  if (!existsSync(statePath)) {
    return emptyState();
  }

  try {
    const raw = JSON.parse(readFileSync(statePath, 'utf8')) as Partial<TrackerState>;
    if (!raw || typeof raw !== 'object') {
      return emptyState();
    }

    const providers: Partial<Record<SourceId, ProviderState>> = {};
    if (raw.providers && typeof raw.providers === 'object') {
      for (const [key, value] of Object.entries(raw.providers)) {
        if (!value || typeof value !== 'object') continue;
        const files = (value as ProviderState).files;
        if (!files || typeof files !== 'object') continue;
        providers[key as SourceId] = { files: { ...files } };
      }
    }

    return {
      version: STATE_VERSION,
      providers,
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
      firstSyncAt: typeof raw.firstSyncAt === 'string' ? raw.firstSyncAt : null
    };
  } catch {
    // Corrupt state — start fresh rather than crash the game. A future sync
    // will re-baseline cursors on its first read.
    return emptyState();
  }
}

export function writeTrackerState(statePath: string, state: TrackerState): void {
  const dir = dirname(statePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  state.version = STATE_VERSION;
  state.updatedAt = new Date().toISOString();
  writeFileSync(statePath, JSON.stringify(state, null, 2));
}

export function getProviderState(state: TrackerState, source: SourceId): ProviderState {
  let ps = state.providers[source];
  if (!ps) {
    ps = { files: {} };
    state.providers[source] = ps;
  }
  return ps;
}

/**
 * Get inode for a file path. Returns null if file is missing or the platform
 * doesn't expose inodes (Windows: still works for NTFS, but skip silently
 * if stat throws).
 */
export function getInode(filePath: string): number | null {
  try {
    const st = statSync(filePath);
    return st.ino;
  } catch {
    return null;
  }
}

/**
 * Decide whether to re-read a file from scratch or pick up where we left off.
 * If inode changed (file was rewritten/rotated), the old offset is meaningless.
 */
export function resolveCursor(prev: FileCursor | null, currentInode: number | null): FileCursor | null {
  if (currentInode == null) {
    return prev;
  }
  if (prev == null) {
    return { inode: currentInode, offset: 0 };
  }
  if (prev.inode !== currentInode) {
    return { inode: currentInode, offset: 0 };
  }
  return prev;
}
