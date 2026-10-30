# 技术栈

## 桌面产品约定

聚宝盆是本地优先的 Electron 桌面应用，不是网站。只有透明聚宝盆与 Token 收获窗口两个玩家界面。聚宝盆本身是桌宠，不再使用示例猫或其他角色。

- Electron 37：透明置顶窗口、收获窗口、托盘、系统目录选择器、单实例和退出生命周期。
- React 19 + Vite 7：收获窗口界面。源码目录沿用 `apps/web`，构建后由 Electron `loadFile` 加载，资源使用相对路径。
- HTML/CSS：透明聚宝盆窗口；与收获窗口共用聚宝盆素材及动作样式。
- TypeScript 5 + Zod：Codex 日志采集、存档校验和共享状态。
- esbuild：将采集器及其依赖打成单个 CommonJS 文件，供 Electron 主进程直接调用。
- Node `node:test` / tsx：单元测试；Playwright Electron：真实桌面窗口冒烟。

## 运行链路

```text
本机 Codex JSONL
  -> Electron 主进程内的 CodexCollector
  -> 原子提交 companion.json
  -> 受限 IPC
  -> 本地透明聚宝盆 / 本地 React 收获窗口
```

桌面启动不创建 HTTP 服务、不监听端口、不打开系统浏览器，也不启动 TokenTracker。

`desktop/server.cjs` 沿用历史文件名，现在只管理本地采集器生命周期。
Fastify 代码保留作开发诊断和历史接口测试，不在桌面启动或发行包中。
旧修仙玩法、自定义角色与 SessionDriver 源码保留，但当前入口不调用、不打包。

## 窗口与安全边界

两个窗口都使用 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`。
preload 只暴露状态、快照收取、武器抽取/分解/兑换、系统选目录、窗口打开/拖动等固定命令。IPC 验证调用者是已知窗口的主 frame；交易输入与余额由主进程校验。

页面禁止网络连接、弹出新窗口和导航离开本地页面，不向界面暴露任意文件或进程操作。

## 素材

- 原图：`desktop/pet/assets/source/jade-basin.png`
- 运行时透明素材：`desktop/pet/assets/processed/jade-basin.webp`
- 窗口与托盘图标：`desktop/pet/assets/processed/jade-basin-icon.png`

原图为内置 imagegen 生成的青玉聚宝盆；WebP 和 PNG 图标只进行尺寸、编码转换，保留 alpha。素材随应用离线打包，不引用远程地址。

## 存储

```text
<Electron userData>/data/companion.json
<Electron userData>/data/companion.json.bak
<Electron userData>/pet-state.json
```

主存档包含绑定时间、累计、今日统计、已查看累计、日志游标与会话高水位。
v2 还保存已消费 Token、武器数量、玄铁、保底和操作回执。余额由已收取减已消费推导，所有交易使用采集器同一串行队列原子提交。请求 ID + 乐观版本校验防止连点重入；重试回执跨重启保存。

武器配置位于 `packages/shared/src/weapons.ts`，规则位于 `apps/server/src/companion/forge.ts`。生产随机数使用 Node crypto，确定性随机源仅在测试中注入。
武器原图为 `desktop/pet/assets/source/weapons.png`；`scripts/process-weapon-assets.mjs` 沿透明行间隙切出 15 张运行时素材。Lucide 图标数据及 ISC 许可证随源码保存，许可证随发行包分发，不依赖外部字体或图标服务。
`pet-state.json` 只读取和保存窗口位置，兼容旧位置但不恢复旧角色选择。

## 开发与发布

Node.js 22.18+，建议 24；pnpm 10。源码运行 `corepack pnpm start`；`dev` 同样进入桌面应用。
Windows 打包 `corepack pnpm dist:win`，完整 ZIP 内携带 Electron、采集器、界面与聚宝盆素材。使用者无需 Node.js、pnpm、Python 或 TokenTracker，只需正常安装并使用 Codex。
