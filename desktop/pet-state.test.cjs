const assert = require('node:assert/strict');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  defaultPetState,
  loadPetState,
  savePetState
} = require('./pet-state.cjs');

test('returns default pet state when no file exists', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'token-game-pet-state-'));

  assert.deepEqual(loadPetState(dir), defaultPetState);

  rmSync(dir, { recursive: true, force: true });
});

test('persists pet bounds and always-on-top preference', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'token-game-pet-state-'));
  const state = {
    bounds: { x: 42, y: 84, width: 180, height: 180 },
    alwaysOnTop: false,
    activePetId: defaultPetState.activePetId
  };

  savePetState(dir, state);

  assert.deepEqual(loadPetState(dir), state);

  rmSync(dir, { recursive: true, force: true });
});

test('persists selected pet asset id', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'token-game-pet-state-'));
  const state = {
    bounds: { x: 12, y: 24, width: 220, height: 220 },
    alwaysOnTop: true,
    activePetId: 'red-swords'
  };

  savePetState(dir, state);

  assert.deepEqual(loadPetState(dir), state);

  rmSync(dir, { recursive: true, force: true });
});

test('falls back to default pet asset id when invalid', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'token-game-pet-state-'));

  savePetState(dir, {
    bounds: { x: 12, y: 24, width: 220, height: 220 },
    alwaysOnTop: true,
    activePetId: ''
  });

  assert.equal(loadPetState(dir).activePetId, defaultPetState.activePetId);

  rmSync(dir, { recursive: true, force: true });
});

test('falls back to defaults when state JSON is invalid', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'token-game-pet-state-'));
  writeFileSync(path.join(dir, 'pet-state.json'), '{not-json');

  assert.deepEqual(loadPetState(dir), defaultPetState);

  rmSync(dir, { recursive: true, force: true });
});
