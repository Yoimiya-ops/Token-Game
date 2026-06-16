import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPetProcessingCommands } from './process-pet-assets.mjs';

test('builds python background removal commands for each source asset', () => {
  const commands = buildPetProcessingCommands('/root/project');

  assert.deepEqual(commands.map((command) => command.output), [
    '/root/project/desktop/pet/assets/processed/red-swords.png',
    '/root/project/desktop/pet/assets/processed/pink-sword.png'
  ]);
  assert.match(commands[0].command, /remove_pet_background\.py/);
});
