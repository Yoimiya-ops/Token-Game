const path = require('node:path');

let gameServer;

async function startEmbeddedServer(app) {
  process.env.TOKEN_GAME_DATA_DIR = path.join(app.getPath('userData'), 'data');

  const serverEntry = path.join(app.getAppPath(), 'apps', 'server', 'dist', 'index.cjs');
  const serverModule = require(serverEntry);
  gameServer = await serverModule.startGameServer({
    port: 3001,
    host: '127.0.0.1'
  });

  return gameServer;
}

async function stopEmbeddedServer() {
  if (gameServer) {
    await gameServer.close();
    gameServer = undefined;
  }
}

module.exports = {
  startEmbeddedServer,
  stopEmbeddedServer
};
