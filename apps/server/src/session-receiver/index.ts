/**
 * Session-receiver public surface. The Fastify routes in `src/index.ts`
 * import from here so the rest of the server never reaches into private
 * helpers.
 */

export * from './types';
export {
  applyTick,
  closeSession,
  evaluateManualRefresh,
  getDevice,
  getOpenSession,
  getSessionById,
  openSession,
  readSessionStore,
  registerDevice,
  resetSessionStoreForTest,
  resolveSessionStorePath,
  sweepIdleSessions,
  verifyCursorMonotonicity,
  writeSessionStore,
  type ApplyTickInput,
  type ApplyTickOutcome,
  type CloseSessionOutcome,
  type OpenSessionResult
} from './store';
export {
  generateDeviceKey,
  parseTickRequest,
  signTick,
  verifyTickSignature
} from './validate';
