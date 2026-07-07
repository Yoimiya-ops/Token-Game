const sessionClient = require('./session-client.cjs');

class GameSession {
  constructor(app, options = {}) {
    this.app = app;
    this.sessionClient = options.sessionClient ?? sessionClient;
    this.getBrowserWindow = options.getBrowserWindow ?? (() => require('electron').BrowserWindow);
  }

  get userData() {
    return this.app.getPath('userData');
  }

  async start() {
    return this.sessionClient.startSession(this.userData);
  }

  async stop() {
    return this.sessionClient.stopSession(this.userData);
  }

  async refreshTokens() {
    const result = await this.sessionClient.manualRefresh(this.userData);
    this.notifyPetWindow(result);
    return result;
  }

  async getActiveSessionInfo() {
    return this.sessionClient.getActiveSessionInfo(this.userData);
  }

  notifyPetWindow(result) {
    const BrowserWindow = this.getBrowserWindow();
    for (const w of BrowserWindow.getAllWindows()) {
      if (w.getTitle() === 'Token Game Pet' && !w.isDestroyed()) {
        w.webContents.send('pet:token-refreshed', result);
      }
    }
  }
}

function createGameSession(app, options) {
  return new GameSession(app, options);
}

module.exports = {
  GameSession,
  createGameSession
};
