/**
 * Session-receiver: HMAC envelope signing/verification + shape parsing.
 *
 * Wire-level integrity model: every tick is signed with a key that is
 * the deviceKey itself. The first call (`openSession`) is NOT signed —
 * the server mints the deviceKey on that call and returns it; from then
 * on all subsequent calls in the session MUST carry a valid signature.
 *
 * Why keying on the deviceKey: it's an opaque 64-hex-char string the
 * client already owns, so using it directly as the HMAC key needs zero
 * additional server-side state per device.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { MIN_DEVICE_KEY_LENGTH } from './types';
import type { TickRequest } from './types';

/** Canonical form for signing: every field except `signature` and
 *  strictly typed meta, JSON-serialised. Both sides use the same
 *  canonicalisation so verification is deterministic. */
function canonicaliseTick(tick: Omit<TickRequest, 'signature'>): string {
  // Sort cursors so the signature is path-order independent of the
  // adapter's iteration order.
  const sortedCursor = [...tick.cursorAfter].sort((a, b) => {
    if (a.providerId !== b.providerId) return a.providerId.localeCompare(b.providerId);
    return a.path.localeCompare(b.path);
  });
  const sortedDeltas = [...tick.deltas].sort((a, b) => a.key.localeCompare(b.key));
  return JSON.stringify({
    deviceKey: tick.deviceKey,
    sessionId: tick.sessionId,
    trigger: tick.trigger,
    clientTimestamp: tick.clientTimestamp,
    deltas: sortedDeltas,
    cursorAfter: sortedCursor
  });
}

/** Sign a tick with the deviceKey. */
export function signTick(tick: Omit<TickRequest, 'signature'>, deviceKey: string): string {
  return createHmac('sha256', deviceKey).update(canonicaliseTick(tick)).digest('hex');
}

/** Verify the signature on a parsed tick using the deviceKey carried
 *  inside the tick itself. Timing-safe hex comparison. */
export function verifyTickSignature(tick: TickRequest): boolean {
  if (typeof tick.signature !== 'string') return false;
  if (typeof tick.deviceKey !== 'string' || tick.deviceKey.length < MIN_DEVICE_KEY_LENGTH) {
    return false;
  }
  const { signature, ...rest } = tick;
  const expected = signTick(rest, tick.deviceKey);
  if (signature.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

/** Parse an unknown JSON value into a typed TickRequest, rejecting
 *  anything that doesn't satisfy the shape. Returns null on failure. */
export function parseTickRequest(body: unknown): TickRequest | null {
  if (!body || typeof body !== 'object') return null;
  const obj = body as Record<string, unknown>;
  if (typeof obj.deviceKey !== 'string') return null;
  if (typeof obj.sessionId !== 'string') return null;
  if (obj.trigger !== 'scheduled' && obj.trigger !== 'manual') return null;
  if (typeof obj.clientTimestamp !== 'string') return null;
  if (!Array.isArray(obj.deltas)) return null;
  if (!Array.isArray(obj.cursorAfter)) return null;
  if (typeof obj.signature !== 'string') return null;

  const deltas = obj.deltas as Array<Record<string, unknown>>;
  for (const d of deltas) {
    if (typeof d.key !== 'string') return null;
    if (typeof d.source !== 'string') return null;
    if (typeof d.model !== 'string') return null;
    if (typeof d.hourStart !== 'string') return null;
    for (const k of [
      'inputTokens',
      'cachedInputTokens',
      'outputTokens',
      'reasoningOutputTokens'
    ]) {
      if (typeof d[k] !== 'number' || !Number.isFinite(d[k] as number) || (d[k] as number) < 0) {
        return null;
      }
    }
  }

  const cursorAfter = obj.cursorAfter as Array<Record<string, unknown>>;
  for (const c of cursorAfter) {
    if (typeof c.providerId !== 'string') return null;
    if (typeof c.path !== 'string') return null;
    if (typeof c.size !== 'number' || !Number.isFinite(c.size) || c.size < 0) return null;
    if (c.inode !== null && (typeof c.inode !== 'number' || !Number.isFinite(c.inode))) {
      return null;
    }
  }

  return {
    deviceKey: obj.deviceKey,
    sessionId: obj.sessionId,
    trigger: obj.trigger,
    clientTimestamp: obj.clientTimestamp,
    deltas: deltas.map((d) => ({
      key: d.key as string,
      source: d.source as string,
      model: d.model as string,
      hourStart: d.hourStart as string,
      inputTokens: d.inputTokens as number,
      cachedInputTokens: d.cachedInputTokens as number,
      outputTokens: d.outputTokens as number,
      reasoningOutputTokens: d.reasoningOutputTokens as number
    })),
    cursorAfter: cursorAfter.map((c) => ({
      providerId: c.providerId as string,
      path: c.path as string,
      size: c.size as number,
      inode: c.inode === undefined ? null : (c.inode as number | null)
    })),
    signature: obj.signature as string
  };
}

/** Mint a fresh 32-byte device key, hex-encoded. */
export function generateDeviceKey(): string {
  return randomBytes(32).toString('hex');
}
