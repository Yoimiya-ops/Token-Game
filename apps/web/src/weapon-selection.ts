export type Point = { x: number; y: number };
export type Bounds = { left: number; top: number; right: number; bottom: number };
export const SELECTION_HOLD_MS = 350;
export const SELECTION_MOVE_PX = 6;

export function strokeIntersects(start: Point, end: Point, bounds: Bounds): boolean {
  let enter = 0;
  let exit = 1;
  // Clip the pointer segment against both axes so fast moves cannot skip cards.
  for (const [origin, delta, low, high] of [
    [start.x, end.x - start.x, bounds.left, bounds.right],
    [start.y, end.y - start.y, bounds.top, bounds.bottom]
  ] as const) {
    if (delta === 0) {
      if (origin < low || origin > high) return false;
      continue;
    }
    const a = (low - origin) / delta;
    const b = (high - origin) / delta;
    enter = Math.max(enter, Math.min(a, b));
    exit = Math.min(exit, Math.max(a, b));
    if (enter > exit) return false;
  }
  return true;
}

export function paintSelection(current: string[], ids: string[], select: boolean): string[] {
  const next = new Set(current);
  for (const id of ids) {
    if (select) next.add(id);
    else next.delete(id);
  }
  return [...next];
}
