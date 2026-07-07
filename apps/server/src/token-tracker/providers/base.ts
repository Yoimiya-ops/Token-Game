import type { RawEvent, SourceId, ProviderState, FileCursor } from '../types';

/**
 * Abstract interface every provider must implement.
 *
 * Lifecycle during one sync:
 *   1. listFiles() — find every session/log file this provider knows about
 *   2. for each file: parseFile(path, prevCursor) -> (events, newCursor)
 *   3. tracker.ts writes newCursor back to state.json
 *
 * Notes:
 *   - listFiles() should be cheap (no reads). One stat per file max.
 *   - parseFile() is the only place that touches file content. Implementations
 *     should respect prevCursor and only return events from bytes after that
 *     offset. If inode changed, the file was rewritten — start from 0.
 */
export interface Provider {
  readonly id: SourceId;
  readonly displayName: string;
  /**
   * Find all session files this provider could read from. Should be safe to
   * call on machines where the provider is not installed (returns []).
   */
  listFiles(): Promise<string[]>;
  /**
   * Parse one file from a cursor, return events read and the new cursor.
   * On parse error, implementations should swallow and return zero events
   * with the cursor unchanged — we never want one bad file to break sync.
   */
  parseFile(filePath: string, prevCursor: FileCursor | null): Promise<{ events: RawEvent[]; newCursor: FileCursor | null }>;
}

/**
 * Helper: get the previous cursor for a file from a provider's state.
 * Returns null if the file has never been seen.
 */
export function getPrevCursor(state: ProviderState | undefined, filePath: string): FileCursor | null {
  if (!state) return null;
  return state.files[filePath] ?? null;
}

/**
 * Helper: store the new cursor for a file in a provider's state.
 * Mutates the state object.
 */
export function setCursor(state: ProviderState, filePath: string, cursor: FileCursor): void {
  state.files[filePath] = cursor;
}
