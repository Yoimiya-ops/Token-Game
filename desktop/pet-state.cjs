const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { defaultPetAssetId, normalizePetAssetId } = require('./pet-assets.cjs');

const STATE_FILE = 'pet-state.json';

const defaultPetState = {
  bounds: {
    x: 80,
    y: 120,
    width: 180,
    height: 180
  },
  alwaysOnTop: true,
  activePetId: defaultPetAssetId
};

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizePetState(value) {
  const bounds = value && typeof value === 'object' ? value.bounds : undefined;
  const activePetId =
    typeof value?.activePetId === 'string' && value.activePetId.startsWith('custom-')
      ? value.activePetId
      : normalizePetAssetId(value?.activePetId);

  return {
    bounds: {
      x: isFiniteNumber(bounds?.x) ? bounds.x : defaultPetState.bounds.x,
      y: isFiniteNumber(bounds?.y) ? bounds.y : defaultPetState.bounds.y,
      width: isFiniteNumber(bounds?.width) ? bounds.width : defaultPetState.bounds.width,
      height: isFiniteNumber(bounds?.height) ? bounds.height : defaultPetState.bounds.height
    },
    alwaysOnTop:
      typeof value?.alwaysOnTop === 'boolean'
        ? value.alwaysOnTop
        : defaultPetState.alwaysOnTop,
    activePetId
  };
}

function getStatePath(userDataPath) {
  return path.join(userDataPath, STATE_FILE);
}

function loadPetState(userDataPath) {
  const statePath = getStatePath(userDataPath);
  if (!existsSync(statePath)) {
    return defaultPetState;
  }

  try {
    return normalizePetState(JSON.parse(readFileSync(statePath, 'utf8')));
  } catch {
    return defaultPetState;
  }
}

function savePetState(userDataPath, state) {
  mkdirSync(userDataPath, { recursive: true });
  writeFileSync(getStatePath(userDataPath), JSON.stringify(normalizePetState(state), null, 2));
}

module.exports = {
  defaultPetState,
  getStatePath,
  loadPetState,
  savePetState
};
