# Token Game

Token Game 是一个本地运行的 Electron 桌面宠物游戏。应用启动后会先显示一只可拖动的桌宠；单击桌宠触发互动，双击桌宠进入游戏界面。游戏会读取本机 TokenTracker 的真实 token 用量，并把新增 token 转换成猫粮。

## 功能概览

- 桌面小宠物常驻桌面，支持拖动、置顶、隐藏到托盘。
- 单击桌宠互动，双击桌宠打开游戏。
- 右键桌宠可以切换、导入、重命名、删除桌宠形象。
- 支持导入 png、jpg、jpeg、webp、gif、apng 图片作为自定义桌宠。
- 内置资源可以重命名；非默认内置资源可以删除，删除后会从用户资源列表隐藏。
- 默认桌宠是内置白猫 webp 动图。
- 游戏界面使用 React 展示猫粮、已追踪 token、处理器等级和最近 token 事件。
- 后端使用 Fastify 内嵌在 Electron 中运行，默认监听 `127.0.0.1:3001`。
- Token 用量通过 `tokentracker-cli` 读取 `~/.tokentracker/tracker/queue.jsonl`。

## 文档

- [玩家启动与游玩指南](docs/player-guide.md)
- [需求文档](docs/requirements.md)
- [接口文档](docs/api.md)
- [开发文档](docs/development.md)
- [桌面端启动文档](docs/desktop-startup.md)
- [打包与发布文档](docs/release.md)
- [技术栈](docs/tech-stack.md)
- [开发流程](docs/workflow.md)

## 环境要求

如果只是下载 GitHub Release 里的压缩包游玩，不需要安装 Node.js 或 pnpm。

从源码启动或参与开发时需要：

- Node.js 20 或更高版本，推荐 Node.js 22 LTS。
- pnpm 10，仓库已在 `package.json` 声明 `packageManager`。
- Git。
- macOS 或 Windows。
- 可选：TokenTracker。未安装或暂无 token 记录时，游戏仍能启动，但不会产生新的真实 token 收益。

## 拉代码后启动

```bash
git clone https://github.com/Yoimiya-ops/Token-Game.git
cd Token-Game
git checkout dev
corepack enable
corepack pnpm install
corepack pnpm start
```

`pnpm start` 会先构建 web/server，再启动 Electron 桌宠。macOS 和 Windows 都使用同一条命令。

## 下载包启动

如果 Release 中已经上传了安装包：

- Windows 下载 `TokenGame-win32-x64.zip`，完整解压后双击 `Token Game-win32-x64/TokenGame.exe`。
- macOS 下载 `TokenGame-darwin-arm64.zip`，解压后双击 `Token Game.app`。如果系统拦截未签名应用，右键选择“打开”。

完整玩法说明见 [玩家启动与游玩指南](docs/player-guide.md)。

## 开发模式

需要前端热更新时，可以开两个终端：

```bash
corepack pnpm dev
```

另一个终端启动桌面端：

```bash
corepack pnpm desktop
```

开发模式下，游戏窗口会优先连接 Vite 的 `http://localhost:3000`；打包/生产模式下会加载内嵌 Fastify 服务的 `http://127.0.0.1:3001/`。

## 常用命令

```bash
corepack pnpm start          # 构建并启动桌面应用
corepack pnpm dev            # 同时启动 server 和 web 开发服务
corepack pnpm desktop        # 仅启动 Electron
corepack pnpm build          # 构建 server 和 web
corepack pnpm test           # 运行 server/shared 相关测试
corepack pnpm test:desktop   # 运行桌面端测试
corepack pnpm test:scripts   # 运行脚本测试
corepack pnpm typecheck      # TypeScript 类型检查
corepack pnpm dist:current   # 打当前系统的桌面包
corepack pnpm dist:mac       # 打 macOS arm64 包
corepack pnpm dist:win       # 打 Windows x64 包
```

## 当前打包产物

打包产物不会提交到 Git。需要本地生成时运行：

```bash
corepack pnpm dist:current
```

macOS 应用会输出到：

```text
outputs/current/Token Game-darwin-arm64/Token Game.app
```

Windows 应用会输出到：

```text
outputs/win/Token Game-win32-x64/TokenGame.exe
```

更详细的启动与打包说明见 [桌面端启动文档](docs/desktop-startup.md) 和 [打包与发布文档](docs/release.md)。
