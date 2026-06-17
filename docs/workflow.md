# 开发流程

## 分支策略

- `main`：稳定分支。
- `dev`：当前开发分支。
- 功能开发优先从 `dev` 拉分支，完成后合回 `dev`。

## 推荐开发循环

1. 从 `dev` 更新代码。
2. 安装依赖：`corepack pnpm install`。
3. 根据任务改动对应层：shared schema、server API、web UI、desktop 桌宠逻辑。
4. 补充或更新测试。
5. 运行验证命令。
6. 更新文档。
7. 提交并 push。

## 提交前验证

至少运行：

```bash
corepack pnpm test
corepack pnpm test:desktop
corepack pnpm test:scripts
corepack pnpm typecheck
```

涉及打包或桌面启动时，额外运行：

```bash
corepack pnpm dist:current
```

需要 Windows 产物时运行：

```bash
corepack pnpm dist:win
```

如果在 macOS 上跨平台 Windows 打包没有生成产物，参考 [打包与发布文档](release.md) 的手动 Windows 打包流程。

## 测试范围

- `corepack pnpm test`：服务端 API、静态资源、TokenTracker 同步和账本逻辑。
- `corepack pnpm test:desktop`：桌宠资源管理、状态持久化、拖动样式和视图映射。
- `corepack pnpm test:scripts`：素材处理和脚本行为。
- `corepack pnpm typecheck`：server/web TypeScript 检查。

## 文档维护规则

以下内容变化时必须更新文档：

- 启动命令、端口、环境变量。
- API 路由、请求/响应结构。
- TokenTracker 同步逻辑或账本格式。
- 桌宠右键菜单、资源管理、打包方式。
- 新增平台启动方式或发布方式。

## 代码约定

- 服务端 authoritative state 写入账本，前端只展示和触发动作。
- Token 事件 schema 先更新 `packages/shared`，再更新 server 和 web。
- 桌宠资源统一通过 `desktop/pet-assets.cjs` 和 `desktop/custom-pet-assets.cjs` 管理。
- 内置资源不在运行时物理删除；删除行为通过 userData 隐藏列表实现。
- 打包产物不提交到 Git。
