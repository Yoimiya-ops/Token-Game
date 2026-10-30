# 构建与发布

首发验证目标为 Windows x64。使用本机安装的同平台 Electron，不跨平台猜测运行时。

## 构建

需要 Node.js 22.18+、pnpm 10，建议 Node.js 24。

```powershell
corepack pnpm install
corepack pnpm typecheck
corepack pnpm test
corepack pnpm test:desktop
corepack pnpm test:scripts
corepack pnpm dist:win
```

esbuild 将采集器及依赖打为 `apps/server/dist/collector.cjs`。React + Vite 构建收获窗口，资源路径必须为相对路径，由 Electron `loadFile` 加载。

发行包仅包含 Electron、必要桌面模块、采集器、编译后的窗口界面、青玉聚宝盆与 15 张武器素材，以及图标许可证。不包含 Fastify 服务、旧猫素材、自定义角色模块、node_modules、日志或用户存档。

```text
outputs/win/TokenGame-win32-x64/TokenGame.exe
outputs/win/TokenGame-win32-x64.zip
```

用户完整解压运行，无需 Node.js、pnpm、Python 或 TokenTracker。应用只读取用户正常安装使用的本机 Codex 日志。

## 原生窗口检查

具备 Playwright 的开发环境运行：

```powershell
node scripts/companion-smoke.cjs
```

外部 Playwright 模块可设置 `PLAYWRIGHT_MODULE_PATH`。检查发行包设置 `TOKEN_GAME_EXECUTABLE` 为 EXE 路径；设置 `TOKEN_GAME_ISOLATED_RUNTIME=1` 可去除子进程 PATH 中 Node/pnpm 搜索路径。脚本使用隔离日志和存档，不修改真实 Codex 文件。

覆盖两种本地窗口、零 HTTP 请求、透明像素、真实待机运动、空收取、单击收取、双击/右键仅开窗、拖动不误收、1000 抽保底、15 张武器素材、十连主按钮、K/M/B 数字、选择模式进入/退出、暗色卡片勾选、键盘选择、长按拖选/取消、快速跨卡不漏选、失去捕获不误触、三档品质快捷选择、取消与确认分解、不误删未选武器、定向兑换、默认/紧凑窗口无需滚动、减少动画、重启保存武器与补采、正常退出。截图和结果在 `outputs/verification`。

五档武器素材已预处理入库。需要重新处理原始图集时运行 `node scripts/process-weapon-assets.mjs`；切图沿透明行间隙定位，不按理想等分截断剑尖。

受限自动化宿主可能无法启动 Chromium 沙箱子进程。脚本允许 `TOKEN_GAME_ELECTRON_ARGS` 作为一次性测试参数；发行代码仍启用 sandbox、contextIsolation，未写入禁用沙箱或 GPU 的参数。自动化通过不等于干净机器人工验收。

2026-10-29 武器 MVP 验证：源码原生流程通过；最终 ZIP 重新解压后，在移除 Node 搜索路径、150% 显示缩放的隔离子进程中通过全部原生流程，结果见 `outputs/verification/package-smoke.json`。本宿主测试临时使用 `--no-sandbox --disable-gpu`，不代表默认安全配置已在独立干净机器上验收。

2026-10-30 周节奏与批量分解：162 项自动化测试通过（server 119、web 3、desktop 39、scripts 1），类型检查和构建通过。新增 500 万抽模拟验证含材料兑换的周产出。源码与最新 ZIP 解压后的原生流程均通过，后者移除 Node 搜索路径并使用 150% 缩放；覆盖 1000 抽、批量勾选/取消/确认、未选库存保护和重启恢复。仍使用上述宿主临时兼容参数；发行包未降低安全配置。最新截图与 package-smoke.json 已更新。

## 发布前人工检查

2026-10-30 交互优化验收：167 项测试通过（server 119、web 8、desktop 39、scripts 1），类型检查与构建通过。最新 ZIP 重新解压、隔离 Node 搜索路径并使用 150% 缩放后，完整原生流程通过；沿用宿主临时兼容参数，不更改发行安全配置。新增数字边界和拖选几何测试，截图 `weapon-forge.png` 为普通浏览，`weapon-batch-selection.png` 与 `receipt-compact-selection.png` 为选择模式。经济配置与存档结构不变。

独立无开发环境 Windows 机器、真实托盘交互、物理多显示器、睡眠唤醒与长期试用仍待人工验收。macOS、代码签名和自动更新不计作本次已完成能力。

源码与发行包的唯一正式入口是 Electron，不分发浏览器体验地址。
