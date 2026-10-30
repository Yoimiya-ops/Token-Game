# 桌面通信

桌面应用不启动 HTTP 服务。两个窗口通过 preload 的 `window.tokenPet` 与 Electron 主进程通信。

## 状态

`getState(): Promise<CompanionState>` 获取快照。
`onState(callback): () => void` 订阅采集与确认后的状态，返回取消订阅方法。

共享定义在 `packages/shared/src/companion.ts`：

- `totalTokens`：绑定后累计。
- `todayTokens`：按事件时间与本地日期计算的今日新增。
- `pendingTokens`：累计减去已查看累计。
- `acknowledgedTokens`：已确认看过的累计位置。
- `legacyTokens`：旧版存档中单独保留的累计。
- `receipt`：上次确认版本、数量和时间。
- `connection`：Codex 目录、状态、最近检查与用量时间、备份恢复标记。
- `forge`：可用余额、已消费量、武器库存、玄铁、累计抽取、两个保底计数、最近抽取结果和交易版本。

## 收取

`collect(observedTotal): Promise<{ state, collectedTokens }>`

只确认界面已展示的累计快照。期间新到达的用量继续待收；重复确认返回零，不重复播放庆祝。
主进程验证非负安全整数，采集器拒绝超过当前累计的快照。保存失败会拒绝 Promise，不推进确认位置。

可用余额由 acknowledgedTokens - forge.spentTokens 推导。重复收取不会重复增加余额；空收取不修改存档，但客户端仍播放 +0 反馈。

## 武器交易

- `draw({ requestId, expectedRevision, count })`：count 仅支持 1 或 10。
- `dismantle({ requestId, expectedRevision, weaponId, quantity })`：正整数数量，不得超过持有量。
- `dismantleBatch({ requestId, expectedRevision, weaponIds })`：当前界面使用。1–15 个不重复、有效且已拥有的武器 ID；按确认时的交易版本，整批分解每种全部持有数量。拒绝空选、未知 ID、重复 ID、零库存或溢出；整批一个事务，不逐项提交。ID 顺序不影响重试去重。
- `exchange({ requestId, expectedRevision, weaponId })`：用固定玄铁价格兑换一把指定武器。

均返回 `{ state, result }`。result 含 kind、weaponIds、quantity、shardsDelta、tokensSpent。
批量分解返回 kind=dismantle，weaponIds 为所选种类，quantity 为总把数，shardsDelta 为总材料；最多保存 15 种 ID 的回执。确认后库存版本变化则拒绝，不会把新出现的武器也误分解。
参数定义在 shared/weapons.ts；成本、概率、保底与材料配置也以该文件为准。

requestId 为 8–80 位字母、数字或连字符；expectedRevision 使用当前 forge.revision。
最近 32 次回执与存档一起保存，同 ID 同请求重试返回原结果，不重复扣款；同 ID 不同内容被拒绝。缓存外的旧请求也会因版本不符拒绝，避免再次执行。

交易与采集共用单写队列；在同一次原子写入中更新余额扣除、奖品、材料、保底和回执。业务校验或保存失败均不部分生效。

## 目录与窗口

- `chooseDirectory()`：系统文件夹选择器；取消返回 null，成功返回新状态。
- `openGame()`：打开或聚焦收获窗口。
- `showContextMenu()`：显示本地菜单。
- `dragTo(x, y)` / `endDrag()` / `saveBounds()`：透明窗口拖动与位置保存。

命令仅接受已知窗口主 frame；不暴露任意文件读取、执行或网络能力。两个页面通过 CSP 禁止网络连接，主进程禁止新窗口和外部导航。

## 诊断接口

历史 Fastify 适配器仅供开发与回归测试，发行包不携带、不启动。
开发者显式运行独立服务时仍可使用 `GET /api/state`、`POST /api/collect`、`POST /api/directory` 和 `GET /health`，语义与上述采集器方法一致。

静态诊断路由不再是玩家入口；收获界面需要 Electron preload，浏览器不能代替桌面应用。
