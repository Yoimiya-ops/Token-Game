import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'package.json'));
const target = process.argv[2] ?? 'current';
const platforms = { current: process.platform, win: 'win32', mac: 'darwin' };
const platform = platforms[target];
if (!platform) throw new Error('Unknown package target');
if (platform !== process.platform) throw new Error('请在目标操作系统上构建发行包，确保携带对应的 Electron 运行时。');
const arch = process.arch;
const executable = require('electron');
const electronDist = path.dirname(executable);
const outDir = path.join(root, 'outputs', target);
const appDir = path.join(outDir, `TokenGame-${platform}-${arch}`);
fs.mkdirSync(outDir, { recursive: true });
if (path.dirname(appDir) !== outDir || !outDir.startsWith(path.join(root, 'outputs') + path.sep)) throw new Error('Invalid package destination');
if (fs.existsSync(appDir)) fs.rmSync(appDir, { recursive: true, force: true });
fs.mkdirSync(appDir);

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
let resources;
if (platform === 'darwin') {
  const bundle = path.join(appDir, 'TokenGame.app');
  fs.cpSync(path.join(electronDist, 'Electron.app'), bundle, { recursive: true });
  resources = path.join(bundle, 'Contents', 'Resources');
} else {
  fs.cpSync(electronDist, appDir, { recursive: true });
  if (platform === 'win32') fs.renameSync(path.join(appDir, 'electron.exe'), path.join(appDir, 'TokenGame.exe'));
  resources = path.join(appDir, 'resources');
}
const source = path.join(resources, 'app');
fs.mkdirSync(source, { recursive: true });
const copy = (relative) => {
  const destination = path.join(source, relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(path.join(root, relative), destination, { recursive: true, dereference: true });
};
for (const file of ['desktop/main.cjs', 'desktop/windows.cjs', 'desktop/server.cjs', 'desktop/tray.cjs', 'desktop/window-state.cjs',
  'desktop/pet/index.html', 'desktop/pet/styles.css', 'desktop/pet/scene.css', 'desktop/pet/pet.js', 'desktop/pet/preload.cjs',
  'desktop/pet/assets/processed/jade-basin.webp', 'desktop/pet/assets/processed/jade-basin-icon.png',
  'apps/server/dist/collector.cjs', 'apps/web/dist', 'apps/web/src/lucide-LICENSE']) copy(file);
fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify({
  name: manifest.name, version: manifest.version, main: manifest.main, private: true
}, null, 2));
fs.writeFileSync(path.join(appDir, 'README.txt'), '聚宝盆 / Token Game\r\n\r\n完整解压后启动 TokenGame.exe。请保留全部同目录文件。\r\n内置运行环境，无需 Node.js、pnpm 或 TokenTracker。\r\n正常使用本机 Codex 后，新增 Token 会自动进入聚宝盆。收取后可用于祈器；武器可分解为玄铁并兑换指定武器。\r\n左键单击收取 Token；右键或左键双击打开收获与武器窗口。托盘可隐藏、显示与退出。\r\n');
if (fs.existsSync(path.join(resources, 'default_app.asar'))) fs.unlinkSync(path.join(resources, 'default_app.asar'));
console.log(`Packaged: ${appDir}`);
if (platform === 'win32') {
  const zip = path.join(outDir, `TokenGame-win32-${arch}.zip`);
  const quote = value => "'" + value.replaceAll("'", "''") + "'";
  if (fs.existsSync(zip)) fs.unlinkSync(zip);
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory(${quote(appDir)}, ${quote(zip)}, [System.IO.Compression.CompressionLevel]::Optimal, $true)`], { windowsHide: true, stdio: 'inherit' });
  console.log(`Archive: ${zip}`);
}
