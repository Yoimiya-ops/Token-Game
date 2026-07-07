import { readFileSync } from 'node:fs';

export type CompleteJsonlLine = {
  text: string;
  byteLength: number;
};

/**
 * Read complete UTF-8 lines from a byte offset.
 *
 * Provider cursors are byte offsets, but JavaScript string.slice() uses
 * UTF-16 code-unit indexes. Reading as Buffer first keeps cursors correct
 * when logs contain CJK text / emoji, and counting only LF-terminated lines
 * avoids the old "one byte past EOF" drift.
 */
export function readCompleteJsonlLinesFromOffset(
  filePath: string,
  startOffset: number
): { lines: CompleteJsonlLine[]; bytesRead: number; totalSize: number } {
  const buffer = readFileSync(filePath);
  const safeStart = Math.max(0, Math.min(Math.floor(startOffset), buffer.length));
  const slice = buffer.subarray(safeStart);
  const lines: CompleteJsonlLine[] = [];

  let lineStart = 0;
  for (let i = 0; i < slice.length; i++) {
    if (slice[i] !== 0x0a) continue;

    const lineEnd = i > lineStart && slice[i - 1] === 0x0d ? i - 1 : i;
    lines.push({
      text: slice.subarray(lineStart, lineEnd).toString('utf8'),
      byteLength: i + 1 - lineStart
    });
    lineStart = i + 1;
  }

  return {
    lines,
    bytesRead: lineStart,
    totalSize: buffer.length
  };
}
