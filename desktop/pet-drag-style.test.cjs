const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const styles = readFileSync(path.join(__dirname, 'pet', 'styles.css'), 'utf8');

test('keeps visible pet body draggable for frameless desktop window movement', () => {
  assert.match(styles, /\.pet\s*\{[^}]*-webkit-app-region:\s*drag;/s);
  assert.doesNotMatch(styles, /\.cat,\s*\n\.pet-image,\s*\n\.bubble\s*\{[^}]*-webkit-app-region:\s*no-drag;/s);
});
