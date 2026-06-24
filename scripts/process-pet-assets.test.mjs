import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { buildPetProcessingCommands } from './process-pet-assets.mjs';

const petOutputs = [
  'default-cat.webp',
  'red-swords.png',
  'pink-sword.png',
  'pink-white-dress.webp'
];

test('builds python background removal commands for each source asset', () => {
  // Use a placeholder absolute path so path.resolve behaves the same on every platform.
  const rootDir = path.resolve('/tmp/token-game-pet-assets');
  const commands = buildPetProcessingCommands(rootDir);

  const expectedOutputs = petOutputs.map((output) =>
    path.resolve(rootDir, 'desktop', 'pet', 'assets', 'processed', output)
  );

  assert.deepEqual(
    commands.map((command) => command.output),
    expectedOutputs
  );
  assert.match(commands[0].command, /remove_pet_background\.py/);
});
