# 开发文档

## 首次启动

```bash
git clone https://github.com/Yoimiya-ops/Token-Game.git
cd Token-Game
git checkout dev
corepack enable
corepack pnpm install
corepack pnpm start
```

`corepack pnpm start` 会执行：

1. 构建 `apps/server`。
2. 构建 `apps/web`。
3. 启动 Electron。
4. Electron 启动内嵌 Fastify 服务。
5. 显示桌宠窗口。

## 开发模式

前端和服务端热更新：

```bash
corepack pnpm dev
```

另开终端启动 Electron：

```bash
corepack pnpm desktop
```

Electron 游戏窗口会在开发模式下优先连接 Vite：

```text
http://localhost:3000
```

如果需要测试生产构建行为，使用：

```bash
corepack pnpm start
```

## 主要模块

### `apps/server`

- `src/index.ts`：Fastify 应用、路由和启动函数。
- `src/store.ts`：本地账本读写、玩家状态、事件入账。
- `src/token-tracker.ts`：TokenTracker 队列读取、delta 计算、外部同步。
- `src/static-root.test.ts`、`src/index.test.ts`、`src/token-tracker.test.ts`：服务端测试。

### `apps/web`

- `src/App.tsx`：游戏主界面。
- `src/styles.css`：游戏界面样式。

### `desktop`

- `main.cjs`：Electron 主入口。
- `server.cjs`：启动/关闭内嵌 Fastify 服务。
- `windows.cjs`：桌宠窗口和游戏窗口。
- `tray.cjs`：托盘菜单和桌宠右键菜单。
- `pet-assets.cjs`：内置桌宠列表、隐藏和重命名。
- `custom-pet-assets.cjs`：自定义桌宠导入、重命名、删除。
- `pet-state.cjs`：桌宠位置、置顶状态、当前桌宠 id。
- `prompt-window.cjs`：重命名输入窗口。
- `pet/`：桌宠渲染页面、样式和 preload。

### `packages/shared`

- `src/token-event.ts`：TokenEvent schema。
- `src/cultivation.ts`：修仙资源、境界和行动成本的共享规则。

### `scripts`

- `package-desktop.mjs`：Electron 跨平台打包脚本。
- `process-pet-assets.mjs`：内置素材处理脚本。
- `remove_pet_background.py`：素材抠图辅助脚本。

## TokenTracker 本地数据

默认读取：

```text
~/.tokentracker/tracker/queue.jsonl
```

如果没有 TokenTracker 数据，应用仍然可以启动，只是不会新增灵气。测试里可以通过 `tokenTrackerQueuePath` 注入临时队列文件。

## 桌宠资源规则

- 默认桌宠 id 是 `default-cat`。
- 默认桌宠不可删除。
- 内置资源定义在 `desktop/pet-assets.cjs`。
- 内置资源文件放在 `desktop/pet/assets/source` 和 `desktop/pet/assets/processed`。
- 内置资源删除不会删除文件，只会写入 `deleted-built-in-pets.json`。
- 内置资源重命名写入 `renamed-built-in-pets.json`。
- 自定义资源复制到 userData 的 `custom-pets/` 目录。

## 测试命令

```bash
corepack pnpm test
corepack pnpm test:desktop
corepack pnpm test:scripts
corepack pnpm typecheck
```

## 常见问题

### 桌宠打开了，但游戏窗口没有页面

先运行：

```bash
corepack pnpm build
```

再运行：

```bash
corepack pnpm desktop
```

或者直接使用：

```bash
corepack pnpm start
```

### `/` 返回 `Route GET:/ not found`

说明 web 构建产物不存在或静态目录没有指向 `apps/web/dist`。运行：

```bash
corepack pnpm build
```

当前代码已有回归测试覆盖 `GET /`。

### Token 没有增长

检查 TokenTracker 是否已产生队列文件：

```bash
ls ~/.tokentracker/tracker/queue.jsonl
```

然后在游戏里点击“同步真实 Token”。
