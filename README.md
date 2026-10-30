# 聚宝盆 · Token Game

一个陪你使用 Codex 的本地修仙聚宝盆。桌宠就是聚宝盆本身，没有猫或其他示例角色。新增 Token 自动汇聚，点开看看收获，收下时灵气入藏。

玩家只有两个界面：可拖动的透明聚宝盆，以及收获与武器窗口。左键单击直接收取 Token，空盆也有动作和 +0 提示；右键或左键双击打开窗口。托盘负责隐藏、显示和退出。

## 下载包启动

首发为 Windows x64 便携包。完整解压 `TokenGame-win32-x64.zip`，运行文件夹里的 `TokenGame.exe`。保留同目录全部文件。

包内携带 Electron 运行环境、采集器、界面和素材，无需 Node.js、pnpm、Python 或 TokenTracker。Codex 由用户正常安装和使用。应用启动即自动采集本机 Codex 的用量日志，只读用量，不读取账号密钥，也不保存对话正文。

首次启动从当前用量建立基线。之后新增 Token 自动保存，退出期间的记录在重开时补采，只要日志还在。收取后进入可用余额，忘记收取不会丢失待收量。消费只扣可用余额，不扣历史累计。

## 两个玩法

- 武器抽取：10 万 Token 一抽，100 万十连；五档 15 把武器。基础概率依次为 75% / 20% / 4.5% / 0.4% / 0.1%，连续 20 抽保底上品及以上、1000 抽保底仙品。
- 分解兑换：点击「批量分解」进入选择模式，卡片选中后变暗打勾，支持单击、长按拖选、全选和凡/良/上品快捷选择；一次确认分解所选种类的全部数量。玄铁直接兑换指定武器，仙品需 6000 玄铁；不自动分解，兑换不改变保底。

祈器十次为主按钮，一次为次按钮；Token 金额使用英文 K / M / B，例如 100K、1M、7.5M，悬停可查看完整值。数值规则不因显示缩写改变。

默认窗口为 1000 × 760 DIP，并按屏幕工作区缩小；主要内容不需要拖动窗口或滚动页面查看。每天 750 万 Token、保留仙品并分解其他武器兑换仙品时，长期平均约 7 天一把仙品。详细数值、假设与波动见 [周节奏与批量分解](docs/design/2026-10-30-weekly-weapons.md)。

默认使用 `CODEX_HOME`，未设置时使用用户目录下的 `.codex`。没有找到目录时，在收获页底部选择文件夹。仅支持当前已验证的本机日志格式；远端、WSL 和云端会话不自动包含在内。

## 源码启动

需要 Node.js 22.18 或更高版本，建议 Node.js 24；使用 pnpm 10 安装依赖。

```powershell
corepack pnpm install
corepack pnpm start
```

`start` 先构建，再启动 Electron。`dev` 也使用桌面入口。两个窗口直接加载本地文件，通过受限 IPC 与主进程通信，不打开浏览器、不监听 HTTP 端口。

React + Vite 是 Electron 收获窗口的界面技术，不是浏览器产品。`apps/web` 是沿用的源码目录名。历史 Fastify 接口仅保留供开发诊断和回归测试，发行包不包含该服务。

## 检查与打包

```powershell
corepack pnpm typecheck
corepack pnpm test
corepack pnpm test:desktop
corepack pnpm test:scripts
corepack pnpm dist:win
```

Windows 产物：

```text
outputs/win/TokenGame-win32-x64/TokenGame.exe
outputs/win/TokenGame-win32-x64.zip
```

打包使用已安装的同平台 Electron，不依赖 macOS 缓存目录、unzip 或在线下载运行时。压缩使用 Windows 自带的 .NET ZipFile。macOS 不在本轮验收范围。

## 存档与旧版本

桌面存档在 Electron 用户数据目录的 `data/companion.json`，一般为 `%APPDATA%/token-game/data`。独立开发服务默认使用 `~/.token-game/data`。

采集位置、累计、已收取进度、消费、武器、材料与保底一起保存，并保留上一份 `.bak`。损坏时恢复备份；两个版本都无法解析则报错，保留原文件。

v1 聚宝盆存档升级到 v2 前保存 `.pre-weapons.bak`。此前已收取的 Token 自动成为可用余额，待收量保持不变；重启不会重复发放。

已有 `ledger.json` 会先备份，旧总量在收获页标记为“旧版累计”，不重新触发奖励。旧资源保留在原档及备份中。当前入口不再运行修仙、建筑或旧会话入账链路。

## 文档

- [玩家指南](docs/player-guide.md)
- [接口](docs/api.md)
- [构建与发布](docs/release.md)
- [当前武器 MVP 范围与数值](docs/design/2026-10-29-weapons-mvp.md)

仓库保留的旧修仙、其他 Provider 和 session 模块属于历史实现，当前桌宠不调用它们。
