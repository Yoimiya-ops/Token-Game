# 桌面端启动文档

如果你只是想玩游戏，优先阅读 [玩家启动与游玩指南](player-guide.md)。

## macOS 从源码启动

```bash
git clone https://github.com/Yoimiya-ops/Token-Game.git
cd Token-Game
git checkout dev
corepack enable
corepack pnpm install
corepack pnpm start
```

启动后会出现桌宠窗口：

- 单击：互动。
- 双击：打开游戏窗口。
- 右键：打开桌宠菜单。
- 托盘菜单：显示桌宠、打开游戏、退出。

## Windows 从源码启动

在 PowerShell 或 Windows Terminal 中执行：

```powershell
git clone https://github.com/Yoimiya-ops/Token-Game.git
cd Token-Game
git checkout dev
corepack enable
corepack pnpm install
corepack pnpm start
```

Windows 和 macOS 使用同一套源码启动命令。

## macOS 运行打包后的应用

生成当前平台包：

```bash
corepack pnpm dist:current
```

生成后双击：

```text
outputs/current/Token Game-darwin-arm64/Token Game.app
```

如果系统拦截未签名应用，可以右键 `.app` 选择“打开”。

## Windows 运行打包后的应用

生成 Windows 包：

```bash
corepack pnpm dist:win
```

生成后运行：

```text
outputs/win/Token Game-win32-x64/TokenGame.exe
```

如果从 zip 分发，需要先完整解压目录，再运行 `TokenGame.exe`。不要只把 exe 单独复制出去，因为 Electron 运行时和资源都在同级目录中。

## 桌宠操作说明

### 单击

触发互动动画和气泡文案。

### 双击

打开游戏窗口。

### 拖动

按住桌宠身体拖动窗口位置。位置会保存到 userData。

### 右键菜单

- 打开游戏
- 添加图片桌宠
- 重命名当前桌宠
- 删除当前桌宠
- 切换桌宠
- 置顶/取消置顶
- 隐藏到托盘
- 退出

## 自定义桌宠

支持导入：

```text
png, jpg, jpeg, webp, gif, apng
```

动图会保留原格式，不会转成静态图。

## 数据位置

Electron 的 userData 目录由系统决定。应用会在该目录下保存：

```text
data/ledger.json
pet-state.json
custom-pets.json
custom-pets/
deleted-built-in-pets.json
renamed-built-in-pets.json
```

这些文件不会提交到 Git。
