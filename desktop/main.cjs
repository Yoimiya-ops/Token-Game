const { app } = require('electron');
const { startEmbeddedServer, stopEmbeddedServer } = require('./server.cjs');
const { createGameWindow } = require('./windows.cjs');

app.whenReady().then(async () => {
  await startEmbeddedServer(app);
  await createGameWindow(app);

  app.on('activate', async () => {
    if (process.platform === 'darwin') {
      await createGameWindow(app);
    }
  });
});

app.on('window-all-closed', async () => {
  await stopEmbeddedServer();

  if (process.platform !== 'darwin') {
    app.quit();
  }
});
