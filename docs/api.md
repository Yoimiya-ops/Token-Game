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

同步 TokenTracker 数据并返回当前修仙状态。新增 token 会转换为灵气。

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

## 资源换算

TokenTracker 的新增 token 会转换成灵气：

```ts
qiGained = tokenEventToQi(deltaTokenCount) + realmLevel * 2;
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
