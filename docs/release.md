# 打包与发布文档

## 构建前检查

```bash
corepack pnpm install
corepack pnpm test
corepack pnpm test:desktop
corepack pnpm test:scripts
corepack pnpm typecheck
```

## macOS 打包

当前机器平台：

```bash
corepack pnpm dist:current
```

明确打 macOS arm64：

```bash
corepack pnpm dist:mac
```

输出：

```text
outputs/current/Token Game-darwin-arm64/Token Game.app
```

或：

```text
outputs/mac/Token Game-darwin-arm64/Token Game.app
```

## Windows 打包

```bash
corepack pnpm dist:win
```

输出：

```text
outputs/win/Token Game-win32-x64/TokenGame.exe
```

如果需要 zip 分发：

```bash
cd outputs/win
zip -qr -X TokenGame-win32-x64.zip "Token Game-win32-x64"
```

Windows 用户需要完整解压 `Token Game-win32-x64` 目录后运行 `TokenGame.exe`。

## Release 附件建议

发布到 GitHub Releases 时建议上传两个附件：

```text
TokenGame-win32-x64.zip
TokenGame-darwin-arm64.zip
```

用户下载后的启动方式见 [玩家启动与游玩指南](player-guide.md)。

## macOS 上跨平台打 Windows 包的注意事项

`scripts/package-desktop.mjs` 会优先使用本机 Electron 缓存。如果 `corepack pnpm dist:win` 退出码为 0 但没有生成 `outputs/win`，可以手动使用缓存的 Windows Electron zip 组装：

```bash
rm -rf outputs/win work/manual-win-package
mkdir -p outputs/win work/manual-win-package
unzip -q ~/Library/Caches/electron/*/electron-v37.10.3-win32-x64.zip -d work/manual-win-package
mv work/manual-win-package/electron.exe work/manual-win-package/TokenGame.exe
mkdir -p work/manual-win-package/resources/app
rsync -a --exclude .git --exclude .superpowers --exclude docs --exclude outputs --exclude prisma --exclude work ./ work/manual-win-package/resources/app/
mv work/manual-win-package "outputs/win/Token Game-win32-x64"
cd outputs/win
zip -qr -X TokenGame-win32-x64.zip "Token Game-win32-x64"
```

## 发布检查

发布前确认：

- `outputs/.../resources/app/apps/web/dist/index.html` 存在。
- `outputs/.../resources/app/apps/server/dist/index.cjs` 存在。
- `outputs/.../resources/app/desktop/pet/assets/processed/default-cat.webp` 存在。
- 桌宠可以打开。
- 双击桌宠可以打开游戏窗口。
- `GET http://127.0.0.1:3001/health` 返回 `{ "ok": true }`。

## 不提交的文件

以下内容不提交到 Git：

- `outputs/`
- `work/`
- `apps/server/dist/`
- `apps/web/dist/`
- `apps/server/data/ledger.json`
- `node_modules/`
