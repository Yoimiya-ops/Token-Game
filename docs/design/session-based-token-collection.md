# Session-based Token Collection 设计

## 目标

把游戏里的"token 入账"从**事后自报**改成**游戏在场才计**,根本性地解决两件事:

1. **反作弊**:玩家想领奖必须让游戏跑着;关掉游戏后,所有 token 消耗都不算。
2. **历史丢失**:删除 `firstSyncAt` 这个刻意丢弃历史的过滤器,避免"装历史"的设计开口子。

副作用:丢掉当前 `trust-batch-receiver` 这一大块链路复杂度,trust chain / batchIndex / prevBatchHash / deviceKey chain 这些攻防,统统不再需要。

## 用户体验(玩家视角)

- 启动游戏(desktop)→ 游戏进入"session"。
- session 开始 → 给每个 CLI 来源拍一张"开局快照"(baseline),写入本地 + 推 server。
- session 期间 → 每 60 秒查一次,看每个 CLI 文件比 baseline 多了多少,**只把增量算成灵气 / 薪火 / 入账 token**。
- 关掉游戏 → 当前 session 封口,server 落盘。
- **session 之间**、**游戏没启动时**、**游戏中途被杀** → 任何 CLI token 消耗一律不算。

## 主动刷新(玩家触发)

被动 ticker(60 秒)只解决"自动化",但玩家刚跑完一波 CLI,**等不及 60 秒**就想看到 token 涨。所以加一条手动通道:

**触发入口(三个位置都给)**:
- desktop pet 窗口右键菜单:"刷新 token"
- web dashboard 顶部"读取天机"按钮旁边加一个"立刻入账"(副按钮)
- desktop tray 菜单二级菜单项(快捷键未来再加)

**API**:
```
POST /v1/sessions/:deviceKey/refresh
  body: { clientTimestamp: ISO, hmacSignature }
  response: { appliedDeltas: number, qiGained: number, totalTokens: number,
             refreshedAt: ISO, nextManualRefreshAllowedAt: ISO }
```

跟 ticker tick 用**同一个 server 端 handler**(经过同一套适配层 + cursor 校验 + HMAC),差别只在触发原因 metadata(`manual|scheduled`)。

**限频**:
- 单 deviceKey 两次手动刷新之间**至少 5 秒**
- 超限返 `429`,response 带 `Retry-After`(秒)和 `nextManualRefreshAllowedAt`
- ticker 不受影响,还是按原节奏

**审计 trail**:
- server 在 session 文件里追加 `manualRefreshes: [{ at, deltasEmitted, tickDurationMs }]`
- 不影响 game state,只为"玩家投诉我手动刷新了但没给我算"时能查证
- UI 上不展示这条审计,工具人 / 调试用

**反作弊分析**:
- manual refresh 走的就是 cursor 增量读,跟 ticker tick 是**完全等价**的代码路径
- 玩家 spam 只会浪费自己的网 + server 算力,**不能多领 token**(cursor 单调推进,没新增就是 0)
- 限频是工程考虑(防 DOS / 防 IO 爆),不是反作弊手段

**UX 反馈**:
- desktop 端:刷新中 → pet 旁边弹一个 spinner / "正在入账...",完成 → toast "本次 +N 灵气 / +M token"(数字从 server 响应里取)
- web 端:按钮 spin → 完成后大字号闪一下数字变化("入账 Token"标签一秒钟高亮 +N)
- 失败(429):toast 显示剩余可点击时间(类似 "5 秒后再试")

## 架构

```
┌─────────────────────────────────────────────────────────────┐
│  Desktop App (Electron)                                       │
│                                                               │
│   on app ready:                                               │
│     GameSession.start()                                       │
│       for each provider:                                      │
│         baseline = adapter.poll(currentCursor)  ← 全量扫一次   │
│         store baseline in sessionMemory                       │
│         POST /v1/sessions (server 也存一份 baseline)             │
│                                                               │
│   ticker (60s, setInterval):                                  │
│     for each provider:                                        │
│       delta = adapter.poll(since=baseline)  ← 增量读           │
│       POST /v1/sessions/:deviceKey/tick                       │
│         body: { deltas, hmacSignature }                       │
│                                                               │
│   on app quit / window close → system tray:                   │
│     GameSession.end()                                         │
│       final flush leftover delta                              │
│       POST /v1/sessions/:deviceKey/close                      │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  Adapter Layer(token 读取唯一入口)                              │
│                                                               │
│   所有 token 读取必须通过此层。                                  │
│   直接读 ~/.claude/projects/*.jsonl 等都是禁止的。                  │
│                                                               │
│   interface TokenProvider {                                   │
│     id: SourceId                                              │
│     discover():   找 log / session 路径(只 stat,不读)             │
│     openCursor(): 在 session 开始时,扫一次,拿到当前 baseline      │
│     poll(cursor): 增量读 → events                            │
│   }                                                           │
│                                                               │
│   claude-code / codex / kimi-code / workbuddy / cursor /      │
│   zcode 走同一个 provider 接口。                                  │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  Server (Fastify)                                              │
│                                                               │
│   POST /v1/sessions                    新建 session            │
│   POST /v1/sessions/:deviceKey/tick    接收增量 + 验签         │
│   POST /v1/sessions/:deviceKey/close   关闭 + flush            │
│   GET  /api/state                     给 web dashboard         │
│                                                               │
│   storage:                                                    │
│   - %APPDATA%/token-game/data/sessions/<deviceKey>.json       │
│     (openSessionId, startedAt, baseline, appliedAt,           │
│      appliedDeltas, expiredAt)                                 │
│   - 用 server-side ledger.applyDeltas() 算 player.qi /         │
│     totalTokens / kindling(沿用现有 store.ts 链路)               │
└─────────────────────────────────────────────────────────────┘
```

## 数据流(一个 session 内)

1. **desktop 启动** → `GameSession.start()`
2. 对每个 provider adapter:
   - `discover()` → 列 log 文件路径(纯 stat, 不读)
   - `openCursor()` → 拿到当前文件大小 + offset,作为 session baseline
3. desktop 调 `POST /v1/sessions`,server 写入 `sessions/<deviceKey>.json`,初始 baseline
4. **每 60 秒 ticker**:
   - 对每个 provider,`poll(sinceCursor)` → delta events
   - 累加到 session.appliedDeltas
   - desktop 调 `POST /v1/sessions/:deviceKey/tick`,HMAC 签名,server:
     - 验签
     - 校验 cursor 连续性(cursor 不允许回退)
     - `applyDeltas(events)` → 更新 player
     - 持久化
5. **desktop 退出** → `GameSession.end()`:
   - `POST /v1/sessions/:deviceKey/close`,server:
     - 关 session,写 expiredAt
     - final 一次 applyDeltas

## 适配层接口(目标)

```ts
// apps/server/src/token-tracker/providers/base.ts (演化后的版本)

/**
 * 唯一被允许读 token 数据的接口。
 *
 * 所有 token 读取必须经过 TokenProvider。
 * 直接读 ~/.claude/...jsonl / ~/.cursor/... 等行为违反设计。
 */
export interface TokenProvider {
  readonly id: SourceId;
  readonly displayName: string;

  /** 列这个 provider 的所有 log / session 文件。只 stat,不读。零成本。 */
  discover(): Promise<string[]>;

  /**
   * session 开始时调用。一次性扫到"现在",作为本次 session 的 baseline。
   * 后续 session.poll 会以这个 baseline 作为起点。
   */
  openCursor(): Promise<{ files: FileCursor[]; capturedAt: string }>;

  /**
   * 增量读。返回 baseline 之后的所有新 events(用 cursor 追踪)。
   * 每次调用 cursor 单调推进,不允许回退。
   */
  poll(cursor: FileCursor): Promise<{ events: RawEvent[]; newCursor: FileCursor }>;
}
```

`discover` / `openCursor` / `poll` 三段切分,**让 60 秒 ticker 只做增量读**,session 启动时一次性 baseline。这把单次同步成本压到最小。

**Provider 实现共用** sqlite-reader 这个工具(`apps/server/src/token-tracker/providers/sqlite-reader.ts`),六个 provider 改实现就行,接口不动。

## 反作弊属性(本设计天然成立的)

| 威胁 | 现状(trust-batch) | 新设计 |
|---|---|---|
| 改 CLI log 加 token | 改完 ledger 自己签就上传 | 改了以后 cursor 推进不了,server 拒绝无效 cursor |
| 装历史(把"我没用"伪报成"我用过 X 亿") | 已防(用 batchIndex 链) | **天然防**:你"装历史"的话,baseline 后才有 token,但 baseline 是游戏启动时拍的 |
| 关游戏期间消耗的 token | 玩家可以事后补传 | **天然防**:游戏关闭期间,adapter 不跑,tick 不发,server 看不到,自然不计 |
| 把日志回滚 | chain 验签防 | 增量 cursor 防:文件 offset 单调推进 |
| 重复上传同一段 | batchIndex + prevBatchHash 防 | HMAC + monotonic cursor 防(同上机制) |
| 玩家 spam 刷"立刻入账"按钮 | N/A | 走 cursor 增量读自然封顶,server 端 5 秒限频防 IO 雪崩 |

**底线**:本机可信度上限没变(玩家能改本机一切),但**反作弊范围从"对抗篡改"收窄到"对抗伪造 session"**。游戏不在场,什么都无效 —— 这就是把"反作弊"从数据层抽到了**时间层**。

## 性能策略

ticker 开销目标:**单次 tick < 50ms,空闲时 < 5ms**。

1. **discover 缓存**:discover 一次,缓存文件路径,后续 tick 不再 stat(spring 文件 mtime 检查代替 stat,POSIX `stat`/`node:fs.stat` 都快)
2. **cursor 增量读**:poll 只读 baseline 之后新增的字节,**不重新读整个 log**
3. **ticker 空闲优化**:60 秒 ticker + 在 openCursor / applyDeltas 之外,**所有同步全部 O(delta) 而不是 O(总文件)**
4. **idle 跳过**:session 进入空闲(玩家 5 分钟无操作)之后,降低 tick 频率到 5 分钟(可后续再说,先按 60 秒硬跑)
5. **adapter no-op**:文件 size 没变时,poll 直接返回 0 events,跳过 applyDeltas 调用
6. **write coalescing**:server 端 `sessions/<deviceKey>.json` 用 append-friendly 的方式,而不是整文件 rewrite(目前 trust-batches 是 rewrite,够小但还能优化)

## 废弃清单(全部删除)

- `apps/server/src/trust-batch-receiver/` 整套(store.ts / validate.ts)
- `apps/server/scripts/verify-trust-batch.mts` 验收脚本
- `apps/server/src/trust-batch-receiver.test.ts` 和 `*.e2e.test.ts`
- `apps/server/src/token-tracker/uploader.ts` 的 HttpUploader
- `apps/server/src/index.ts` 里的 `POST /v1/trust-batches`、`GET /v1/trust-batches/:deviceKey`、`trustBatchServerUrl` / `trustBatchStorePath` 选项
- 桌面端:`state.json` 里的 `deviceKey` / `trustBatchIndex` / `lastTrustBatchHash`
- 客户端:`~/.token-game/tracker/trust-batches.jsonl`(改成 `~/.token-game/tracker/sessions/<deviceKey>.jsonl`,只记录 session 元数据,不存 batch 链)
- 设计/共识:`docs/*` 任何引用 trust-batch chain 的章节

## 保留清单(沿用现有代码)

- `store.ts` 算 player.qi / kindling / totalTokens 的链路(`qiGainedFor`、`applyDeltas`)— 只换 caller,从 trust-batch 接收器换成 session tick 接收器
- 六个 provider adapter 主体实现,只改接口实现细节
- `sqlite-reader.ts` 通用工具
- web dashboard 的 React UI、`App.tsx` 的"洞府资源账签"展示逻辑
- desktop Electron 启动 / tray / pet-window / game-window 主流程
- HMAC 签名机制(只是签名对象从 batch 改成 tick envelope)

## 迁移 / 兼容性

**分阶段迁移,不一刀切**:

1. **第一阶段**:server 加新 endpoint(POST /v1/sessions、tick、close),新增 `SessionStore`;desktop 新增 `GameSession` 包装,**双写**(旧 trust-batch 也发,新 tick 也发),数据观察一致
2. **第二阶段**:web dashboard 数据源切到新 endpoint / GET /api/state 依然读 store.ts,只是 store.ts 数据从 trust-batch 迁移到 session tick
3. **第三阶段**:杀掉旧代码,删 trust-batch 链路
4. **第四阶段**:写 `verify:session` 端到端验收脚本,模拟"开 session → tick N 次 → 关闭"全流程

兼容性:
- **旧 user 的 ledger.json**:不动,直接被新代码读(只是 client 不再写它,改由 server 写 player ledger)
- **旧 user 的 trust-batches.jsonl**:删除(只占空间,不影响)
- **server `apps/server/data/trust-batches.json`**:删除

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| 桌面被强杀,GameSession.end() 没跑 → session 永远开着 | server 加 session sweep:超过 N 分钟没收到 tick 自动 close,based on session.startedAt + maxIdleMs |
| 用户装多个 CLI,某个 adapter 永远没文件 | discover 返回 [] 时,这个 provider 在 session 内不消耗 tick |
| Cursor inode 重写(某些 CLI 会切文件) | adapter openCursor 同时记录 inode,cache 时 inode 变了 → reset cursor,从 0 重读 |
| 第一次跑的玩家没历史,要从 0 开始 | OK,这就是设计预期,跟 trust-batch 一致 |
| 玩家跨设备 | deviceKey 跟着 desktop user data,不做跨设备同步(设计上限就是单台机器;跨设备就是 cross-device 三方对战,不在本设计) |

## 验收标准(verify:session 必须 PASS)

**端到端验收脚本 `apps/server/scripts/verify-session.mts` 必须跑通下面所有 case**:

1. 启动 session → 拿 baseline → 立即关闭 → player.qi 是 0(没有任何 token 进来)
2. 启动 session → mock 一个 CLI 文件新增 N 个 token → 等 1 分钟 tick → player.qi 反映 N
3. 启动 session → 不动 CLI → tick 6 次(模拟 6 分钟)→ player.qi 是 0(adapter no-op)
4. 启动 session → 在 CLI 文件**回滚**(把 size 改小)→ 下一 tick 拒绝(403)
5. 启动 session → 一个 adapter 同时多个文件并行,events 全部正确合并
6. 启动 session → close 它 → 再发 tick → 拒绝 410(Gone)
7. server 重启 → 重新读 sessions store → 上一个未关闭的 session 被 sweep 关闭
8. 没有 deviceKey 但有 session → 用未签名 tick → 401
9. cursor 重复 / 倒退 → 拒绝
10. 同一 deviceKey 启动两个 session(并发)→ server 拒绝 409,只允许一个 open session
11. session 内立刻调 manual refresh → 立刻返回本次 delta(spinner → toast)
12. session 内连点 manual refresh → 第二次 5 秒内 429,带 Retry-After
13. session 内 ticker tick 与 manual refresh 并行触发 → server 串行化处理,结果一致(都用最新 cursor)
14. session closed 之后调 manual refresh → 拒绝 410(Gone)

## 关键决策记录(写明为什么)

- **删除 firstSyncAt filter**:原来 filter 防"装历史",但新设计根本不需要"装历史"这种攻击维度,所以 filter 也就不需要了
- **保留 HMAC 签名**:虽然没了 chain,但签名仍然必要 —— server 还是要确认 tick 来自这个 deviceKey(防止伪造别人的 token 流)
- **deviceKey 留着**:不存整链,只存一个对称密钥,在 tick envelope 签名用 + 玩家身份
- **server 端存储 sessions/<deviceKey>.json**:可读、可审、append-friendly,适合 GUI 调试工具看
- **cursor 单调推进**:server 端不存"已读 byte",因为 cursor 由 client 维护;server 只验"大于上次 cursor"
- **60 秒硬间隔**:用户拍板。后续若 idle 优化再加,文档会跟。
