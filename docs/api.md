# 接口文档

## 基本信息

本地 API 由 Fastify 提供。Electron 桌面端启动时会内嵌启动服务：

```text
http://127.0.0.1:3001
```

开发模式下 server 也默认使用同一端口。所有接口都是本机接口，不需要鉴权。

## 数据模型

### TokenEvent

```ts
type TokenEvent = {
  id: string;
  source: 'mock' | 'manual-import' | 'openai' | 'tokentracker';
  model: string;
  kind: 'input' | 'output' | 'cached' | 'reasoning';
  tokenCount: number;
  occurredAt: string;
  metadata?: Record<string, string | number | boolean>;
};
```

### GameStateResponse

```ts
type GameStateResponse = {
  player: {
    kittenName: string;
    food: number;
    totalTokens: number;
    lastFedAt: string | null;
    processorLevel: number;
    lifetimeFoodSpent: number;
  };
  progression: {
    nextProcessorCost: number;
    passiveIntervalMs: number;
  };
  events: Array<TokenEvent & { foodGained: number }>;
};
```

## 路由

### `GET /`

返回构建后的 React 游戏首页 `index.html`。

用途：

- Electron 游戏窗口加载入口。
- 浏览器直接访问本地服务时的入口。

### `GET /health`

健康检查。

响应：

```json
{
  "ok": true
}
```

### `GET /api/state`

同步 TokenTracker 数据并返回当前游戏状态。

处理流程：

1. 调用 `tokentracker-cli` 同步，频率受 30 秒节流保护。
2. 读取 `~/.tokentracker/tracker/queue.jsonl`。
3. 计算每个 token bucket 的新增 delta。
4. 写入账本。
5. 返回当前状态。

响应示例：

```json
{
  "player": {
    "kittenName": "Mochi",
    "food": 128,
    "totalTokens": 2048,
    "lastFedAt": "2026-06-17T07:00:00.000Z",
    "processorLevel": 1,
    "lifetimeFoodSpent": 25
  },
  "progression": {
    "nextProcessorCost": 50,
    "passiveIntervalMs": 30000
  },
  "events": [
    {
      "id": "tokentracker:codex:gpt-5:2026-06-17T07-00-00.000Z:input:1024:delta-1024",
      "source": "tokentracker",
      "model": "gpt-5",
      "kind": "input",
      "tokenCount": 1024,
      "occurredAt": "2026-06-17T07:00:00.000Z",
      "metadata": {
        "tracker": "TokenTracker",
        "trackerSource": "codex",
        "bucketKey": "codex|gpt-5|2026-06-17T07:00:00.000Z|input"
      },
      "foodGained": 12
    }
  ]
}
```

### `POST /api/actions/burst`

手动触发一次 TokenTracker 同步，并返回当前游戏状态。

请求体：无。

响应：同 `GET /api/state`。

### `POST /api/upgrades/processor`

购买处理器升级。

请求体：无。

价格公式：

```ts
nextProcessorCost = 25 * 2 ** processorLevel;
```

成功响应：同 `GET /api/state`。

失败响应：

```json
{
  "error": "猫粮不足，无法购买处理器升级。"
}
```

失败状态码：`400`。

## 资源换算

token 到猫粮的基础换算逻辑在 `packages/shared/src/token-event.ts`。

当前处理器等级会给每个新增 token delta 事件提供额外收益：

```ts
foodGained = tokenEventToResourceDelta(event).food + processorLevel * 2;
```

## 环境变量

### `TOKEN_GAME_DATA_DIR`

可选。覆盖服务端账本目录。

Electron 桌面端会自动设置为：

```text
<Electron userData>/data
```

开发 server 未设置时默认使用：

```text
apps/server/data
```
