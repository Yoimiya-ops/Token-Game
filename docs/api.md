# 接口文档

## 基本信息

本地 API 由 Fastify 提供。Electron 桌面端启动时会内嵌启动服务：

```text
http://127.0.0.1:3001
```

所有接口都是本机接口，不需要鉴权。

## 数据模型

```ts
type GameStateResponse = {
  player: {
    kittenName: string;
    realm: string;
    realmLevel: number;
    qi: number;
    spiritStone: number;
    spiritHerb: number;
    pills: number;
    cultivation: number;
    totalTokens: number;
    lastFedAt: string | null;
    kindling: number;
  };
  homestead: {
    omen: {
      fortune: "大吉" | "小吉" | "平" | "小凶";
      favors: string[];
      verse: string;
      rolledAt: string;
    } | null;
    treasureBasin: {
      dayKey: string | null;
      dailyCondenses: number;
      lastCondensedAt: string | null;
    };
    spiritBeast: {
      name: string;
      status: "idle" | "traveling";
      route: string | null;
      lastDispatchedAt: string | null;
      returnsAt: string | null;
    };
    inventory: Array<{
      id: string;
      name: string;
      kind: "herb" | "stone" | "pill" | "curio";
      quantity: number;
      createdAt: string;
      description: string;
    }>;
    logs: Array<{
      id: string;
      type: "omen" | "treasure" | "beast";
      title: string;
      body: string;
      occurredAt: string;
    }>;
  };
  progression: {
    nextPracticeCost: number;
    nextBreakthroughCost: number;
    passiveIntervalMs: number;
  };
  events: Array<TokenEvent & { qiGained: number }>;
};
```

## 路由

### `GET /`

返回构建后的 React 游戏首页 `index.html`。

### `GET /health`

健康检查，返回 `{ "ok": true }`。

### `GET /api/state`

同步 TokenTracker 数据并返回当前修仙状态。新增 token 会转换为灵气和少量薪火，并在返回前推进洞府后台流程，例如灵兽旅行到点归山。

### `POST /api/actions/burst`

手动触发一次 TokenTracker 同步，也就是前端的“读取天机”。

### `POST /api/actions/practice`

修炼。消耗灵气并获得修为。灵气不足时返回 400：

```json
{
  "error": "灵气不足，无法继续修炼。"
}
```

### `POST /api/actions/farm`

照看灵田。获得灵草和少量灵石。

### `POST /api/actions/meditate`

打坐入定。获得稳定灵气和修为。

### `POST /api/actions/alchemy`

开炉炼丹。消耗等量灵草和灵石，获得丹药。材料不足时返回 400：

```json
{
  "error": "灵草或灵石不足，丹炉无法开火。"
}
```

### `POST /api/actions/breakthrough`

服丹突破。消耗修为和 1 枚丹药提升境界。条件不足时返回 400：

```json
{
  "error": "修为或丹药不足，尚不可突破。"
}
```

### `POST /api/actions/divination`

观星台起卦。写入 `homestead.omen`，并追加一条洞府札记。

### `POST /api/actions/treasure-basin/condense`

聚宝盆凝物。消耗 1 点 `kindling`，每天最多凝物 3 次。成功后会把产物写入 `homestead.inventory`，并根据产物类型同步增加灵草、灵石或丹药。条件不足时返回 400：

```json
{
  "error": "薪火不足，或聚宝盆今日凝物次数已满。"
}
```

### `POST /api/actions/beast/dispatch`

派遣灵兽出游。消耗 1 枚灵石，灵兽进入 `traveling` 状态，约 30 分钟后可通过后台推进归山。条件不足时返回 400：

```json
{
  "error": "灵兽尚未归来，或灵石不足。"
}
```

### `POST /api/actions/tick`

手动推进一次洞府后台流程。一般不需要前端主动调用，因为 `/api/state` 和服务端定时器都会推进；测试或调试时可传入指定时间：

```json
{
  "now": "2026-06-22T02:31:00.000Z"
}
```

## 资源换算

TokenTracker 的新增 token 会转换成灵气：

```ts
qiGained = tokenEventToQi(deltaTokenCount) + realmLevel * 2;
```

同一笔 token 入账还会增加薪火：

```ts
kindlingGained = Math.max(1, Math.floor(qiGained / 5));
```

修炼消耗：

```ts
nextPracticeCost = 12 * 2 ** realmLevel;
```

突破消耗：

```ts
nextBreakthroughCost = 100 * 2 ** realmLevel;
```

## 环境变量

### `TOKEN_GAME_DATA_DIR`

可选。覆盖服务端账本目录。Electron 桌面端会自动设置为：

```text
<Electron userData>/data
```
