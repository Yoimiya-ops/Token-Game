const assert = require('node:assert/strict');
const test = require('node:test');
const { GameSession } = require('./game-session.cjs');

test('GameSession refreshTokens delegates to sessionClient and notifies the pet window', async () => {
  const sent = [];
  const fakeWindow = {
    getTitle: () => 'Token Game Pet',
    isDestroyed: () => false,
    webContents: {
      send: (channel, payload) => sent.push({ channel, payload })
    }
  };
  const app = {
    getPath: (name) => {
      assert.equal(name, 'userData');
      return 'user-data-dir';
    }
  };
  const result = { ok: true, totalTokens: 42, qiGained: 3, triggersAppliedBySource: { codex: 42 } };
  const sessionClient = {
    async startSession() {},
    async stopSession() {},
    async manualRefresh(userData) {
      assert.equal(userData, 'user-data-dir');
      return result;
    },
    async getActiveSessionInfo() {}
  };

  const gameSession = new GameSession(app, {
    sessionClient,
    getBrowserWindow: () => ({ getAllWindows: () => [fakeWindow] })
  });

  assert.equal(await gameSession.refreshTokens(), result);
  assert.deepEqual(sent, [{ channel: 'pet:token-refreshed', payload: result }]);
});
