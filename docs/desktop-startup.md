# 桌面端启动

## Windows 便携包

完整解压 `outputs/win/TokenGame-win32-x64.zip`，双击文件夹内的 `TokenGame.exe`。
不要单独拷贝 EXE；同目录包含 Electron 运行时与应用资源。无需 Node.js、pnpm、Python 或 TokenTracker。

首次启动出现透明聚宝盆与收获窗口；以后启动仅恢复聚宝盆，右键或左键双击可打开窗口。
关闭收获窗口不会退出应用，托盘「退出」才会停止采集。

## 源码启动

需要 Node.js 22.18+（建议 24）和 pnpm 10。

```powershell
corepack pnpm install
corepack pnpm start
```

`start` 先构建，再启动 Electron。`dev` 也进入桌面应用。
已构建时可以 `corepack pnpm desktop` 直接启动。
应用使用本地文件与 IPC，不需要浏览器或 localhost 服务。

## 聚宝盆操作

- 左键单击：收取 Token，播放收入爆发；空盆同样动作并提示 +0。
- 左键双击或右键：打开或聚焦唯一的收获窗口，不收取。
- 按住拖动：调整位置，松开后保存。
- 新增 Token：短暂吸纳灵气，随后保持微光。
- 悬停：显示待收取量；平时不常驻数字面板。
- 托盘：显示聚宝盆、隐藏聚宝盆、查看收获、退出。
- 窗口内「收取灵气」：收取本次显示的 Token 快照，进入可用余额。
- 窗口内「祈器」与「分解 · 兑换」：只进行武器抽取、分解和定向兑换。

单击立即回弹，收取延后 500 毫秒以区分双击；拖动取消待执行单击。默认窗口 1000 × 760 DIP，根据屏幕工作区自动适配；默认与 820 × 640 紧凑尺寸的主要内容无需滚动。

首次连接从当前日志建立基线，不灌入安装前历史。退出期间的新增用量在重启后补采。
目录未找到时，在收获窗口底部展开状态并使用系统文件夹选择器。

## 数据

默认在 Electron userData 下保存 `data/companion.json`、备份和 `pet-state.json`。
Windows 通常为 `%APPDATA%/token-game`。测试可用 `TOKEN_GAME_USER_DATA_DIR` 和 `TOKEN_GAME_DATA_DIR` 指定隔离目录。

macOS 打包入口保留，但不属于本轮已验证的发行平台。
