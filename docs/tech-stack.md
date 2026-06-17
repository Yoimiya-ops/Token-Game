# 技术栈

## 总体架构

Token Game 是一个本地优先的 Electron 应用：

- Electron 主进程负责桌宠窗口、游戏窗口、托盘菜单、右键菜单和本地 Fastify 服务生命周期。
- React + Vite 负责游戏界面。
- Fastify 提供本地 HTTP API，并负责同步 TokenTracker 数据和维护游戏账本。
- `packages/shared` 放置前后端共享的 token 事件 schema 和资源转换规则。
- 桌宠资源、桌宠状态和游戏账本都保存在本机，默认不依赖远程服务。

## 主要依赖

- Electron 37：桌面应用壳、透明桌宠窗口和托盘。
- React 19：游戏 UI。
- Vite 7：前端开发和构建。
- Fastify 5：本地 API 服务。
- Zod：共享 DTO 校验。
- TypeScript 5：web/server/shared 类型检查。
- tsup：服务端 CJS 构建，供 Electron 主进程 require。
- Node.js `node:test`：桌面端和脚本测试。
- `tsx --test`：服务端 TypeScript 测试。
- `tokentracker-cli`：接入 mm7894215/TokenTracker 的真实 token 统计。
- sharp + Python 背景处理脚本：用于内置桌宠素材预处理。

## 目录结构

```text
Token-Game/
  apps/
    server/              # Fastify API、账本、TokenTracker 同步
    web/                 # React 游戏界面
  desktop/               # Electron 主进程、桌宠窗口、托盘、桌宠资源管理
  packages/
    shared/              # 共享 token event schema 和资源转换逻辑
  scripts/               # 打包、素材处理脚本
  docs/                  # 项目文档
  package.json           # workspace 脚本
```

## 数据存储

### 开发环境

服务端默认数据文件：

```text
apps/server/data/ledger.json
```

### Electron 桌面端

Electron 会设置 `TOKEN_GAME_DATA_DIR`，把游戏账本放到系统 userData 下：

```text
<Electron userData>/data/ledger.json
```

桌宠状态和自定义桌宠也保存在 userData：

```text
<Electron userData>/pet-state.json
<Electron userData>/custom-pets.json
<Electron userData>/custom-pets/
<Electron userData>/deleted-built-in-pets.json
<Electron userData>/renamed-built-in-pets.json
```

## TokenTracker 集成

应用通过 `tokentracker-cli` 执行同步，并读取默认队列：

```text
~/.tokentracker/tracker/queue.jsonl
```

队列中的每个小时桶会拆成 input、cached、output、reasoning 四类 token 事件。应用只处理新增 token delta，避免重复入账。

## 打包策略

- macOS 当前平台包：`corepack pnpm dist:current`
- macOS arm64 包：`corepack pnpm dist:mac`
- Windows x64 包：`corepack pnpm dist:win`

打包脚本位于 `scripts/package-desktop.mjs`。产物默认放在 `outputs/`，该目录被 `.gitignore` 忽略。
