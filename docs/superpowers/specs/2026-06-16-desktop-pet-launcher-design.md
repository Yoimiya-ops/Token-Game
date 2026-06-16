# 桌面小宠物启动器设计

## 目标

让 Token Game 启动时先显示桌面小宠物，再由玩家通过小宠物进入完整游戏界面。
同一套 Electron 应用需要支持 macOS 和 Windows：

- macOS 输出：`Token Game.app`
- Windows 输出：便携式应用目录内的 `TokenGame.exe`

第一版优先保证跨平台桌宠体验可用，安装器、签名和商店级发布体验先延后。

## 用户体验

玩家启动打包后的应用时，不直接打开完整 dashboard，而是在桌面上先出现一个小型悬浮宠物窗口。

小宠物窗口：

- 透明、无边框，默认始终置顶
- 只显示小猫本体，不显示普通应用窗口边框
- 可以拖动到桌面任意位置
- 记住上次位置
- 小宠物存在时，游戏服务在后台持续运行

小宠物交互：

- 单击：只做互动，例如跳一下、眨眼、显示一句短气泡。
- 双击：打开或聚焦完整游戏窗口。
- 右键：显示菜单，包含“打开游戏”“置顶/取消置顶”“隐藏到托盘”“退出”。

窗口和托盘行为：

- 关闭小宠物窗口时，不退出应用，而是隐藏到系统托盘。
- 托盘图标可以恢复小宠物或打开游戏。
- 从托盘菜单或小宠物右键菜单选择退出时，干净关闭内置 server。

## 架构

使用 Electron 作为跨平台桌面壳。本功能路径不继续使用现有 C# launcher，因为 Electron 已经提供透明窗口、托盘菜单、无边框窗口、IPC，以及 macOS/Windows 同源打包能力。

主进程职责：

- 启动内置 Fastify 游戏 server
- 创建小宠物窗口
- 创建和管理完整游戏窗口
- 创建托盘图标和菜单
- 将小宠物位置持久化到 Electron user data
- 协调单击、双击、隐藏、恢复、退出等行为

渲染层职责：

- 小宠物渲染层：渲染桌面小猫和轻量互动动画
- 游戏渲染层：继续使用现有 React 游戏 dashboard

数据流：

1. Electron 启动。
2. 主进程把 `TOKEN_GAME_DATA_DIR` 设置到 Electron user data 目录下。
3. 主进程从 `apps/server/dist/index.cjs` 启动内置 server。
4. 主进程打开小宠物窗口。
5. 小宠物渲染层通过 IPC 发送单击、双击、拖动结束和菜单动作。
6. 主进程在需要时打开或聚焦完整游戏窗口。
7. 完整游戏窗口加载现有构建后的 web 应用。

## 打包

新增跨平台打包命令：

- `dist:mac`：构建 server 和 web，然后打包 macOS 应用。
- `dist:win`：构建 server 和 web，然后打包 Windows 便携式应用。

推荐输出结构：

```text
outputs/
  mac/
    Token Game-darwin-*/
      Token Game.app
  win/
    Token Game-win32-x64/
      TokenGame.exe
```

现有 `scripts/package-win.mjs` 可以泛化为跨平台打包脚本，或替换为基于 `@electron/packager` 的 `package-desktop.mjs`。

## 实现备注

- 保留现有 Fastify server 和 React dashboard。
- 新增专用小宠物渲染资源，建议放在 `desktop/pet/`。
- 小宠物窗口使用适合桌宠的 `BrowserWindow` 配置：
  - `frame: false`
  - `transparent: true`
  - `resizable: false`
  - `alwaysOnTop: true`
  - `skipTaskbar: true`
- 保持 `setIgnoreMouseEvents(false)`，让点击和拖动正常工作。
- 在小宠物渲染层用短计时器区分单击和双击。
- 把小宠物位置保存为 `app.getPath('userData')` 下的小 JSON 文件。
- 关闭完整游戏窗口时，保留小宠物和 server 运行。
- 关闭小宠物窗口时隐藏到托盘，不销毁应用。

## 错误处理

- 内置 server 启动失败时，用 Electron dialog 显示错误，避免应用静默消失。
- 游戏窗口无法加载构建产物时，开发环境 fallback 到 `http://localhost:3000`。
- 托盘图标缺失导致托盘创建失败时，继续保留小宠物窗口，并记录错误。

## 测试

自动化检查：

- 保持现有 `pnpm test`、`pnpm typecheck`、`pnpm build` 通过。
- 如果提取了纯函数，补充小宠物位置持久化、单击/双击判定等 focused tests。

手动检查：

- macOS 开发启动：`pnpm desktop`
- macOS 打包后的 `.app` 先显示小宠物
- Windows 打包后的 `.exe` 先显示小宠物
- 单击只触发互动，不打开游戏窗口
- 双击打开或聚焦游戏窗口
- 小宠物可以拖动，并恢复上次位置
- 关闭小宠物会隐藏到托盘
- 托盘恢复和退出动作可用

## 延后事项

- macOS 应用签名
- Windows 可执行文件签名
- `.dmg` 安装包
- Windows 安装器
- 正式生产图标
- 由游戏资源驱动的更丰富宠物状态和动画
