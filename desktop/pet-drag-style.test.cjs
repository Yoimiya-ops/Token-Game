const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const styles = readFileSync(path.join(__dirname, 'pet', 'styles.css'), 'utf8');
const petJs = readFileSync(path.join(__dirname, 'pet', 'pet.js'), 'utf8');

test('disables native image drag so dragging the pet never copies files to the desktop', () => {
  const indexHtml = readFileSync(path.join(__dirname, 'pet', 'index.html'), 'utf8');
  assert.match(indexHtml, /id="pet-image"[^>]*draggable="false"/);
  assert.match(styles, /\.pet-image\s*\{[^}]*-webkit-user-drag:\s*none;/s);
  assert.match(styles, /\.pet-image\s*\{[^}]*pointer-events:\s*none;/s);
});

test('keeps the pet body interactive so click and contextmenu reach the page', () => {
  // Drag is now driven from JS via IPC so the click/contextmenu handlers stay reachable.
  assert.match(styles, /\.pet\s*\{[^}]*-webkit-app-region:\s*no-drag;/s);
});

test('uses pointer events with capture so drag survives the cursor leaving the window', () => {
  assert.match(petJs, /pet\.addEventListener\('pointerdown'/);
  assert.match(petJs, /setPointerCapture\(/);
  assert.match(petJs, /pet\.addEventListener\('pointermove'/);
  assert.match(petJs, /pet\.addEventListener\('pointerup'/);
  assert.match(petJs, /window\.tokenPet\.dragTo\(/);
  assert.match(petJs, /window\.tokenPet\.endDrag\(\)/);
});

test('suppresses the click that the browser fires right after a drag ends', () => {
  assert.match(petJs, /let\s+justDragged\s*=\s*false/);
  assert.match(petJs, /justDragged\s*=\s*true/);
  assert.match(petJs, /if\s*\(\s*justDragged\s*\)\s*\{[^}]*return/m);
});
