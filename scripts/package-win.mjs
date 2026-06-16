import packager from '@electron/packager';
import fs from 'node:fs';
import path from 'node:path';

const cwd = process.cwd();
const outDir = path.resolve(cwd, 'outputs');
fs.rmSync(outDir, { recursive: true, force: true });

function ignore(filePath) {
  const relativePath = path.relative(cwd, filePath);
  if (!relativePath || relativePath.startsWith(`node_modules${path.sep}`)) {
    return false;
  }

  const parts = relativePath.split(path.sep);
  return ['.git', 'docs', 'outputs', 'prisma', 'work'].includes(parts[0]);
}

const appPaths = await packager({
  dir: cwd,
  out: outDir,
  overwrite: true,
  prune: false,
  asar: false,
  platform: 'win32',
  arch: 'x64',
  name: 'Token Game',
  executableName: 'TokenGame',
  ignore
});

for (const appPath of appPaths) {
  console.log(`Packaged: ${appPath}`);
}
