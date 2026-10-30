import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { SELECTION_HOLD_MS, SELECTION_MOVE_PX, strokeIntersects, type Point } from './weapon-selection';

type Gesture = {
  pointerId: number; id: string; origin: Point; last: Point; active: boolean; moved: boolean;
  select: boolean; visited: Set<string>; grid: HTMLDivElement; button: HTMLButtonElement;
};

export function useWeaponDragSelection(enabled: boolean, checkedIds: string[], onPaint: (ids: string[], select: boolean) => void) {
  const latest = useRef({ checkedIds, onPaint });
  latest.current = { checkedIds, onPaint };
  const gesture = useRef<Gesture | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [dragging, setDragging] = useState(false);

  function cancel() {
    clearTimeout(timer.current);
    const current = gesture.current;
    gesture.current = null;
    if (current?.grid.hasPointerCapture(current.pointerId)) current.grid.releasePointerCapture(current.pointerId);
    setDragging(false);
  }
  useEffect(() => {
    window.addEventListener('blur', cancel);
    return () => { window.removeEventListener('blur', cancel); cancel(); };
  }, [enabled]);

  function paint(current: Gesture, end: Point) {
    const ids: string[] = [];
    for (const button of current.grid.querySelectorAll<HTMLButtonElement>('button[data-weapon-id]:not(:disabled)')) {
      const id = button.dataset.weaponId!;
      if (!current.visited.has(id) && strokeIntersects(current.last, end, button.getBoundingClientRect())) {
        current.visited.add(id);
        ids.push(id);
      }
    }
    current.last = end;
    if (ids.length) latest.current.onPaint(ids, current.select);
  }
  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!enabled || event.button !== 0 || !event.isPrimary) return;
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-weapon-id]');
    if (!button || button.disabled) return;
    cancel();
    const origin = { x: event.clientX, y: event.clientY };
    const id = button.dataset.weaponId!;
    const current: Gesture = {
      pointerId: event.pointerId, id, origin, last: origin, active: false, moved: false,
      select: !latest.current.checkedIds.includes(id), visited: new Set(), grid: event.currentTarget, button
    };
    gesture.current = current;
    button.focus({ preventScroll: true });
    current.grid.setPointerCapture(event.pointerId);
    timer.current = setTimeout(() => {
      if (gesture.current !== current || current.moved || current.button.disabled || !current.button.isConnected) return;
      if (!current.grid.hasPointerCapture(current.pointerId)) { cancel(); return; }
      current.active = true;
      setDragging(true);
      paint(current, origin);
    }, SELECTION_HOLD_MS);
  }
  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const end = { x: event.clientX, y: event.clientY };
    if (current.active) paint(current, end);
    else if (Math.hypot(end.x - current.origin.x, end.y - current.origin.y) > SELECTION_MOVE_PX) {
      current.moved = true;
      clearTimeout(timer.current);
    }
  }
  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const end = { x: event.clientX, y: event.clientY };
    if (current.active) paint(current, end);
    else if (!current.moved && !current.button.disabled && strokeIntersects(end, end, current.button.getBoundingClientRect())) {
      latest.current.onPaint([current.id], current.select);
    }
    cancel();
  }
  function onPointerCancel(event: PointerEvent<HTMLDivElement>) {
    if (gesture.current?.pointerId === event.pointerId) cancel();
  }
  return { dragging, handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onLostPointerCapture: onPointerCancel } };
}
