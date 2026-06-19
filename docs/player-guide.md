# 玩家启动与游玩指南

这份文档面向只想启动和游玩 Token Game 的用户。

## 方式一：下载包启动

### Windows

1. 在 GitHub Releases 下载：

   ```text
   TokenGame-win32-x64.zip
   ```

2. 右键 zip，选择“全部解压”。
3. 进入解压后的目录：

   ```text
   Token Game-win32-x64
   ```

4. 双击启动：

   ```text
   TokenGame.exe
   ```

注意：不要只把 `TokenGame.exe` 单独拖出去运行。这个程序依赖同目录下的 Electron 运行时和 `resources` 资源目录。

### macOS

1. 在 GitHub Releases 下载：

   ```text
   TokenGame-darwin-arm64.zip
   ```

2. 双击解压。
3. 双击：

   ```text
   Token Game.app
   ```

4. 如果 macOS 提示应用来自未知开发者，右键 `Token Game.app`，选择“打开”，再确认打开。

当前 macOS 包面向 Apple Silicon，也就是 arm64 机器。

## 方式二：从源码启动

Windows 和 macOS 命令一致。

```bash
git clone https://github.com/Yoimiya-ops/Token-Game.git
cd Token-Game
git checkout dev
corepack enable
corepack pnpm install
corepack pnpm start
```

启动成功后，屏幕上会先出现桌面小宠物。

## 桌宠怎么用

### 单击桌宠

单击会触发互动动画和气泡文案。

### 双击桌宠

双击会打开游戏界面。

### 拖动桌宠

按住桌宠身体拖动，可以移动桌宠位置。位置会自动保存。

### 右键桌宠

右键会打开桌宠管理菜单：

- 打开游戏
- 添加图片桌宠
- 重命名当前桌宠
- 删除当前桌宠
- 切换桌宠
- 置顶/取消置顶
- 隐藏到托盘
- 退出

### 隐藏到托盘

选择“隐藏到托盘”后，桌宠窗口会消失但应用仍在运行。点击托盘图标可以恢复桌宠。

## 如何换桌宠

### 切换内置桌宠

右键桌宠，打开“切换桌宠”，选择想展示的角色。

### 导入自己的桌宠

右键桌宠，选择“添加图片桌宠...”，选择本地图片。

支持格式：

```text
png, jpg, jpeg, webp, gif, apng
```

webp、gif、apng 动图会保留动图效果。

### 重命名桌宠

右键桌宠，选择“重命名当前桌宠...”。内置桌宠和自定义桌宠都可以重命名。

### 删除桌宠

右键桌宠，选择“删除当前桌宠...”。

- 默认白猫不能删除，它是兜底桌宠。
- 非默认内置桌宠删除后会从列表隐藏。
- 自定义桌宠删除后，会移除应用保存的图片文件和记录。

## 游戏怎么玩

打开游戏界面后，可以看到：

- 洞府名与本命桌宠
- 当前境界和突破进度
- 灵气、修为、灵石、灵草、丹药
- 修炼、种田、打坐、炼丹四个功能页
- 最近天机记录

### 读取天机

点击“读取天机”，游戏会尝试读取 TokenTracker 记录，把新增 token 转换成灵气。

### 修炼

进入“修炼”页，点击“开始修炼”消耗灵气并获得修为。

### 种田

进入“种田”页，点击“照看灵田”获得灵草和少量灵石。

### 打坐

进入“打坐”页，点击“入定片刻”获得稳定灵气和修为。

### 炼丹

进入“炼丹”页，点击“开炉炼丹”消耗灵草和灵石，获得丹药。

### 突破

当修为和丹药足够时，点击“服丹突破”提升境界。

修炼消耗公式：

```text
12 * 2 ^ 当前境界等级
```

突破消耗公式：

```text
100 * 2 ^ 当前境界等级
```

## TokenTracker 说明

游戏通过 `tokentracker-cli` 读取本机 TokenTracker 数据：

```text
~/.tokentracker/tracker/queue.jsonl
```

如果你的电脑上还没有 TokenTracker 数据，游戏也能正常打开，只是暂时不会增加真实 token 收益。

当前支持统计：

- input token
- cached input token
- output token
- reasoning output token

游戏只结算新增 token，不会重复结算旧记录。

## 常见问题

### Windows 双击 exe 没反应

确认你是完整解压整个 `Token Game-win32-x64` 文件夹后运行 `TokenGame.exe`，而不是只复制了 exe。

### macOS 提示无法打开

这是未签名应用的常见提示。右键 `Token Game.app`，选择“打开”。

### 游戏窗口打不开

先右键桌宠选择“打开游戏”。如果还是打不开，退出应用后重新启动。

### Token 不增长

确认 TokenTracker 是否已经生成数据：

```bash
ls ~/.tokentracker/tracker/queue.jsonl
```

然后回到游戏界面点击“同步真实 Token”。
