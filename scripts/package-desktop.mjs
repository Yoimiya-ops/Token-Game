import packager from '@electron/packager';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const cwd = process.cwd();
const target = process.argv[2] ?? 'current';
const platformMap = {
  mac: 'darwin',
  win: 'win32',
  current: process.platform
};

const platform = platformMap[target];
if (!platform) {
  throw new Error(`Unknown desktop package target: ${target}`);
}

const arch = target === 'win' ? 'x64' : process.arch;
const electronCacheDir = path.join(os.homedir(), 'Library', 'Caches', 'electron');
const electronVersion = '37.10.3';
const electronZipName = `electron-v${electronVersion}-${platform}-${arch}.zip`;
const localZipDir = path.resolve(cwd, 'work', 'electron-zip-cache');
const tmpdir = path.resolve(cwd, 'work', 'electron-packager-tmp');

function findCachedElectronZip() {
  if (platform !== 'darwin' || !fs.existsSync(electronCacheDir)) {
    return undefined;
  }

  const entries = fs.readdirSync(electronCacheDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const candidate = path.join(electronCacheDir, entry.name, electronZipName);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function prepareLocalElectronZipDir() {
  const cachedZip = findCachedElectronZip();
  if (!cachedZip) {
    return undefined;
  }

  fs.mkdirSync(localZipDir, { recursive: true });
  fs.copyFileSync(cachedZip, path.join(localZipDir, electronZipName));
  return localZipDir;
}

const electronZipDir = prepareLocalElectronZipDir();

function copyDirectory(source, destination) {
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true });
}

function copyAppSource(destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(cwd, { withFileTypes: true })) {
    if (['.git', '.superpowers', 'docs', 'outputs', 'prisma', 'work'].includes(entry.name)) {
      continue;
    }

    copyDirectory(path.join(cwd, entry.name), path.join(destination, entry.name));
  }
}

function packageLocalMacApp() {
  const electronApp = path.join(
    cwd,
    'node_modules',
    '.pnpm',
    `electron@${electronVersion}`,
    'node_modules',
    'electron',
    'dist',
    'Electron.app'
  );
  if (!fs.existsSync(electronApp)) {
    throw new Error(`Local Electron.app not found: ${electronApp}`);
  }

  const appDir = path.join(outDir, `Token Game-darwin-${arch}`);
  const appPath = path.join(appDir, 'Token Game.app');
  const resourcesDir = path.join(appPath, 'Contents', 'Resources');
  const appSourceDir = path.join(resourcesDir, 'app');
  copyDirectory(electronApp, appPath);
  copyAppSource(appSourceDir);
  const plistPath = path.join(appPath, 'Contents', 'Info.plist');
  fs.writeFileSync(
    plistPath,
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n` +
      `<plist version="1.0">\n` +
      `<dict>\n` +
      `  <key>CFBundleExecutable</key>\n` +
      `  <string>Electron</string>\n` +
      `  <key>CFBundleIdentifier</key>\n` +
      `  <string>local.token-game.desktop</string>\n` +
      `  <key>CFBundleName</key>\n` +
      `  <string>Token Game</string>\n` +
      `  <key>CFBundleDisplayName</key>\n` +
      `  <string>Token Game</string>\n` +
      `  <key>CFBundlePackageType</key>\n` +
      `  <string>APPL</string>\n` +
      `  <key>CFBundleShortVersionString</key>\n` +
      `  <string>0.1.0</string>\n` +
      `  <key>CFBundleVersion</key>\n` +
      `  <string>0.1.0</string>\n` +
      `  <key>LSMinimumSystemVersion</key>\n` +
      `  <string>10.13</string>\n` +
      `</dict>\n` +
      `</plist>\n`
  );
  execFileSync('plutil', ['-lint', plistPath]);
  console.log(`Packaged: ${appPath}`);
}

const outDir = path.resolve(cwd, 'outputs', target);
fs.rmSync(outDir, { recursive: true, force: true });
fs.rmSync(tmpdir, { recursive: true, force: true });

function ignore(filePath) {
  const relativePath = path.relative(cwd, filePath);
  if (!relativePath || relativePath.startsWith(`node_modules${path.sep}`)) {
    return false;
  }

  const parts = relativePath.split(path.sep);
  return ['.git', '.superpowers', 'docs', 'outputs', 'prisma', 'work'].includes(parts[0]);
}

async function main() {
  console.log(`Packaging Token Game for ${platform}/${arch}`);

  if (platform === 'darwin') {
    packageLocalMacApp();
    return;
  }

  const appPaths = await packager({
    dir: cwd,
    out: outDir,
    overwrite: true,
    tmpdir,
    prune: false,
    asar: false,
    platform,
    arch,
    name: 'Token Game',
    executableName: 'TokenGame',
    electronVersion,
    electronZipDir,
    download: {
      mirrorOptions: {
        mirror: process.env.ELECTRON_MIRROR ?? 'https://npmmirror.com/mirrors/electron/'
      }
    },
    ignore
  });

  console.log(`Packager returned ${appPaths.length} path(s).`);
  for (const appPath of appPaths) {
    console.log(`Packaged: ${appPath}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
