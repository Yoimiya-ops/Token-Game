const path = require('node:path');
let companion;

function startCompanion(app, onState) {
  const { CodexCollector } = require(path.join(app.getAppPath(), 'apps', 'server', 'dist', 'collector.cjs'));
  companion = new CodexCollector({
    dataDir: process.env.TOKEN_GAME_DATA_DIR || path.join(app.getPath('userData'), 'data'),
    onState
  });
  // The desktop runtime reads local logs directly. No HTTP listener or browser is needed.
  void companion.start().catch(error => console.error('Codex collector:', error));
  return companion;
}
function getCompanion() { return companion; }
async function stopCompanion() {
  if (companion) { await companion.close(); companion = undefined; }
}
module.exports = { startCompanion, stopCompanion, getCompanion };
