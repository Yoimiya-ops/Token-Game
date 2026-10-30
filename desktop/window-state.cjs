const fs = require('node:fs');
const path = require('node:path');
const defaults = { x: 80, y: 120, width: 320, height: 300 };

function normalize(value) {
  const bounds = { ...defaults };
  for (const key of Object.keys(bounds)) {
    if (Number.isFinite(value?.bounds?.[key])) bounds[key] = value.bounds[key];
  }
  return { bounds };
}
function loadWindowState(directory) {
  try {
    return normalize(JSON.parse(fs.readFileSync(path.join(directory, 'pet-state.json'), 'utf8')));
  } catch { return normalize(null); }
}
function saveWindowState(directory, value) {
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'pet-state.json');
  fs.writeFileSync(file + '.tmp', JSON.stringify(normalize(value), null, 2));
  fs.renameSync(file + '.tmp', file);
}
module.exports = { loadWindowState, saveWindowState };
