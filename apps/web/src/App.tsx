import { useEffect, useMemo, useState } from 'react';
import type { TokenEvent } from '@token-game/shared';

type HomesteadLog = {
  id: string;
  type: 'omen' | 'treasure' | 'beast';
  title: string;
  body: string;
  occurredAt: string;
};

type OmenState = {
  fortune: '大吉' | '小吉' | '平' | '小凶';
  favors: string[];
  verse: string;
  rolledAt: string;
};

type InventoryItem = {
  id: string;
  name: string;
  kind: 'herb' | 'stone' | 'pill' | 'curio';
  quantity: number;
  createdAt: string;
  description: string;
};

type GameState = {
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
    omen: OmenState | null;
    treasureBasin: {
      dayKey: string | null;
      dailyCondenses: number;
      lastCondensedAt: string | null;
    };
    spiritBeast: {
      name: string;
      status: 'idle' | 'traveling';
      route: string | null;
      lastDispatchedAt: string | null;
      returnsAt: string | null;
    };
    inventory: InventoryItem[];
    logs: HomesteadLog[];
  };
  progression: {
    nextPracticeCost: number;
    nextBreakthroughCost: number;
    passiveIntervalMs: number;
  };
  events: Array<TokenEvent & { qiGained: number }>;
  tracker: {
    lastAttemptedAt: string | null;
    lastSucceededAt: string | null;
    lastError: string | null;
    lastImportedTokens: number;
    queuePath: string;
    queueUpdatedAt: string | null;
  };
};

type BuildingId = 'treasure' | 'farm' | 'alchemy' | 'beast' | 'practice' | 'meditate' | 'divination' | 'archive';

type ActionId =
  | 'burst'
  | 'practice'
  | 'farm'
  | 'meditate'
  | 'alchemy'
  | 'breakthrough'
  | 'divination'
  | 'treasure'
  | 'beast';

type Building = {
  id: BuildingId;
  label: string;
  subtitle: string;
  className: string;
};

const buildings: Building[] = [
  { id: 'farm', label: '灵植园', subtitle: '三畦待收', className: 'n1' },
  { id: 'alchemy', label: '丹房', subtitle: '炉火温养', className: 'n2' },
  { id: 'beast', label: '兽栏', subtitle: '灵兽旅行', className: 'n3' },
  { id: 'divination', label: '观星台', subtitle: '朱批天机', className: 'n4' },
  { id: 'treasure', label: '聚宝盆', subtitle: '薪火凝物', className: 'n5' },
  { id: 'practice', label: '阵枢', subtitle: '引灵入体', className: 'n6' },
  { id: 'meditate', label: '静室', subtitle: '闭关打坐', className: 'n7' },
  { id: 'archive', label: '藏经阁', subtitle: '残卷归档', className: 'n8' }
];

const actionCopy: Record<ActionId, string> = {
  burst: '正在读取外界天机',
  practice: '正在引灵入体',
  farm: '正在照看灵植园',
  meditate: '正在闭目入定',
  alchemy: '正在开炉炼丹',
  breakthrough: '正在服丹破境',
  divination: '正在观星起卦',
  treasure: '正在投入薪火',
  beast: '正在派遣灵兽'
};

export function shouldShowTianjiOverlay(state: { isLoading: boolean; isTransitioning: boolean }) {
  return state.isLoading || state.isTransitioning;
}

function formatNumber(value: number | undefined) {
  return typeof value === 'number' ? value.toLocaleString('zh-CN') : '--';
}

function formatShortTime(value: string | null | undefined) {
  if (!value) {
    return '未记录';
  }
  return new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function trackerStatusText(state: GameState | null) {
  if (!state?.tracker) {
    return '天机尚未入账';
  }
  if (state.tracker.lastError) {
    return `天机同步异常：${state.tracker.lastError}`;
  }
  if (state.tracker.lastSucceededAt) {
    return `天机同步 ${formatShortTime(state.tracker.lastSucceededAt)}，队列 ${formatShortTime(state.tracker.queueUpdatedAt)}`;
  }
  if (state.tracker.queueUpdatedAt) {
    return `读取本地天机 ${formatShortTime(state.tracker.queueUpdatedAt)}`;
  }
  return '天机队列尚未生成';
}

function eventLabel(kind: TokenEvent['kind']) {
  return {
    input: '入息',
    cached: '藏息',
    output: '吐纳',
    reasoning: '悟道'
  }[kind];
}

function progressPercent(state: GameState | null) {
  if (!state) {
    return 0;
  }
  return Math.min(100, Math.round((state.player.cultivation / state.progression.nextBreakthroughCost) * 100));
}

function buildingStatus(building: Building, state: GameState | null) {
  if (!state) {
    return building.subtitle;
  }

  if (building.id === 'treasure') {
    return state.player.kindling > 0 && state.homestead.treasureBasin.dailyCondenses < 3
      ? '可凝聚一次'
      : '薪火待续';
  }
  if (building.id === 'beast') {
    return state.homestead.spiritBeast.status === 'traveling'
      ? `${state.homestead.spiritBeast.route ?? '远山'}未归`
      : '可遣出游';
  }
  if (building.id === 'alchemy') {
    return state.player.spiritHerb > 0 && state.player.spiritStone > 0 ? '材料可炼' : '材料不足';
  }
  if (building.id === 'divination') {
    return state.homestead.omen ? `${state.homestead.omen.fortune}已批` : '未起今日卦';
  }
  if (building.id === 'practice') {
    return state.player.qi >= state.progression.nextPracticeCost ? '灵气可引' : '灵气不足';
  }
  if (building.id === 'farm') {
    return `灵草 ${formatNumber(state.player.spiritHerb)}`;
  }
  if (building.id === 'meditate') {
    return `修为 ${formatNumber(state.player.cultivation)}`;
  }
  return `${state.homestead.inventory.length} 件入库`;
}

function actionForBuilding(building: BuildingId): ActionId | null {
  const actions: Record<BuildingId, ActionId | null> = {
    treasure: 'treasure',
    farm: 'farm',
    alchemy: 'alchemy',
    beast: 'beast',
    practice: 'practice',
    meditate: 'meditate',
    divination: 'divination',
    archive: null
  };
  return actions[building];
}

function isActionDisabled(action: ActionId | null, state: GameState | null, busyAction: ActionId | null) {
  if (!action || busyAction !== null || !state) {
    return true;
  }
  if (action === 'practice') {
    return state.player.qi < state.progression.nextPracticeCost;
  }
  if (action === 'alchemy') {
    return state.player.spiritHerb < 1 || state.player.spiritStone < 1;
  }
  if (action === 'breakthrough') {
    return state.player.cultivation < state.progression.nextBreakthroughCost || state.player.pills < 1;
  }
  if (action === 'treasure') {
    return state.player.kindling < 1 || state.homestead.treasureBasin.dailyCondenses >= 3;
  }
  if (action === 'beast') {
    return state.player.spiritStone < 1 || state.homestead.spiritBeast.status === 'traveling';
  }
  return false;
}

export default function App() {
  const [state, setState] = useState<GameState | null>(null);
  const [activeBuilding, setActiveBuilding] = useState<BuildingId>('treasure');
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<ActionId | null>(null);
  const [transitionCopy, setTransitionCopy] = useState('正在读取洞府天机');
  const [isTransitioning, setIsTransitioning] = useState(true);
  const apiBase = '';

  useEffect(() => {
    let cancelled = false;

    async function loadState() {
      try {
        const response = await fetch(`${apiBase}/api/state`);
        const data = (await response.json()) as GameState;
        if (!cancelled) {
          setState(data);
          setError(null);
          window.setTimeout(() => setIsTransitioning(false), 420);
        }
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message);
          setIsTransitioning(false);
        }
      }
    }

    void loadState();
    const timer = window.setInterval(() => {
      void loadState();
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const realmProgress = useMemo(() => progressPercent(state), [state]);
  const activeNode = buildings.find((building) => building.id === activeBuilding) ?? buildings[0];
  const primaryAction = actionForBuilding(activeNode.id);
  const recentLogs = state?.homestead.logs.slice(0, 5) ?? [];
  const recentEvents = state?.events.slice(0, 4) ?? [];
  const favorText = state?.homestead.omen?.favors.length ? state.homestead.omen.favors.join('、') : '尚未批注';

  async function runAction(action: ActionId) {
    const endpoint =
      action === 'burst'
        ? `${apiBase}/api/actions/burst`
        : action === 'breakthrough'
          ? `${apiBase}/api/actions/breakthrough`
          : action === 'divination'
            ? `${apiBase}/api/actions/divination`
            : action === 'treasure'
              ? `${apiBase}/api/actions/treasure-basin/condense`
              : action === 'beast'
                ? `${apiBase}/api/actions/beast/dispatch`
                : `${apiBase}/api/actions/${action}`;

    try {
      setBusyAction(action);
      setTransitionCopy(actionCopy[action]);
      setIsTransitioning(true);
      const response = await fetch(endpoint, { method: 'POST' });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? '洞府法阵运转失败');
      }

      setState(data as GameState);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyAction(null);
      window.setTimeout(() => setIsTransitioning(false), 460);
    }
  }

  return (
    <main className="page">
      {shouldShowTianjiOverlay({ isLoading: !state, isTransitioning }) ? (
        <div className="tianji-overlay" role="status" aria-live="polite">
          <div className="tianji-ring" />
          <p>{transitionCopy}</p>
          <span>灵机流转，洞府禁制正在校准</span>
        </div>
      ) : null}

      <section className="top-note">
        <div>
          <span className="eyebrow">Token Game / 破落山门</span>
          <h1>云栖宗洞府总览</h1>
        </div>
        <div className="top-actions">
          <div className="top-action-buttons">
            <button disabled={busyAction !== null} onClick={() => void runAction('burst')} type="button">
              {busyAction === 'burst' ? '读取中' : '读取天机'}
            </button>
            <button
              className="ghost-button"
              disabled={isActionDisabled('breakthrough', state, busyAction)}
              onClick={() => void runAction('breakthrough')}
              type="button"
            >
              服丹破境
            </button>
          </div>
          <span className={`tracker-status ${state?.tracker.lastError ? 'is-error' : ''}`}>
            {trackerStatusText(state)}
          </span>
        </div>
      </section>

      <section className="game-shell">
        <section className="scroll-stage" aria-label="洞府卷轴主界面">
          <header className="stage-head">
            <div>
              <span className="eyebrow ink-eyebrow">掌中洞天图</span>
              <h2>{state?.player.kittenName ?? '洞府灵伴'}的山门</h2>
              <p>
                聚宝盆已认主，外界 Token 化作灵池余炁。今日朱批：
                {state?.homestead.omen ? `${state.homestead.omen.fortune}，宜${favorText}。` : '观星台尚未起卦。'}
              </p>
            </div>
            <aside className="realm-slip">
              <span>当前境界</span>
              <strong>{state?.player.realm ?? '读取中'}</strong>
              <div className="progress-line">
                <i style={{ width: `${realmProgress}%` }} />
              </div>
              <small>破境准备 {realmProgress}%</small>
            </aside>
          </header>

          <section className="ledger-tags" aria-label="洞府资源账签">
            <LedgerTag label="灵池余炁" value={formatNumber(state?.player.qi)} />
            <LedgerTag label="薪火可投" value={formatNumber(state?.player.kindling)} />
            <LedgerTag label="库中灵石" value={formatNumber(state?.player.spiritStone)} />
            <LedgerTag label="入账 Token" value={formatNumber(state?.player.totalTokens)} />
          </section>

          <section className="map-area" aria-label="洞府建筑地图">
            <div className="route" />
            {buildings.map((building) => (
              <button
                className={`ink-node ${building.className} ${building.id === activeBuilding ? 'is-active' : ''}`}
                key={building.id}
                onClick={() => setActiveBuilding(building.id)}
                type="button"
              >
                {building.label}
                <small>{buildingStatus(building, state)}</small>
              </button>
            ))}
          </section>

          <section className="bottom-ledger" aria-label="洞府账册摘要">
            <LedgerEntry title="灵植园" body={`灵草 ${formatNumber(state?.player.spiritHerb)} 株，可继续照看换取炼丹材料。`} />
            <LedgerEntry title="丹房" body={`丹药 ${formatNumber(state?.player.pills)} 枚，破境需 1 枚并满足修为。`} />
            <LedgerEntry
              title="灵兽"
              body={
                state?.homestead.spiritBeast.status === 'traveling'
                  ? `${state.homestead.spiritBeast.name}行至${state.homestead.spiritBeast.route ?? '远山'}，${formatShortTime(state.homestead.spiritBeast.returnsAt)}归山。`
                  : `${state?.homestead.spiritBeast.name ?? '灵兽'}伏于兽栏，可遣出游。`
              }
            />
            <LedgerEntry title="藏经阁" body={`库房收录 ${formatNumber(state?.homestead.inventory.length)} 件凝聚产物。`} />
          </section>
        </section>

        <aside className="side-book" aria-label="洞府札记">
          <section className="book-card divination">
            <span className="eyebrow">观星台朱批</span>
            <div className="fortune-title">
              <h3>今日卦象</h3>
              <strong>{state?.homestead.omen?.fortune ?? '未卜'}</strong>
            </div>
            <p>{state?.homestead.omen ? `${state.homestead.omen.verse} 宜 ${favorText}。` : '星盘未启，山门诸事暂按常规运转。'}</p>
            <div className="seal-row">
              <button disabled={isActionDisabled('divination', state, busyAction)} onClick={() => void runAction('divination')} type="button">
                另起一卦
              </button>
              <button className="secondary-action" disabled={busyAction !== null} onClick={() => setActiveBuilding('divination')} type="button">
                查看星盘
              </button>
            </div>
          </section>

          <section className="book-card">
            <span className="eyebrow">当前建筑</span>
            <h3>{activeNode.label}</h3>
            <p>{buildingDescription(activeNode.id, state)}</p>
            <div className="paper-list">
              {buildingPapers(activeNode.id, state).map((item) => (
                <div className="paper-item" key={item.label}>
                  <b>
                    {item.label}
                    <span>{item.value}</span>
                  </b>
                  <p>{item.body}</p>
                </div>
              ))}
            </div>
            {primaryAction ? (
              <button
                className="primary-action"
                disabled={isActionDisabled(primaryAction, state, busyAction)}
                onClick={() => void runAction(primaryAction)}
                type="button"
              >
                {actionButtonLabel(activeNode.id)}
              </button>
            ) : null}
            {error ? <p className="error">{error}</p> : null}
          </section>

          <section className="book-card activity-log">
            <span className="eyebrow">洞府札记</span>
            <h3>天机记录</h3>
            <div className="log-list">
              {recentLogs.length ? (
                recentLogs.map((log) => (
                  <div className="log-line" key={log.id}>
                    <mark>{logMark(log.type)}</mark>
                    <p>
                      <b>{log.title}</b>
                      {log.body}
                    </p>
                  </div>
                ))
              ) : (
                <div className="log-line">
                  <mark>静</mark>
                  <p>洞府初开，札记尚空。</p>
                </div>
              )}
              {recentEvents.map((event) => (
                <div className="log-line token-log" key={event.id}>
                  <mark>{eventLabel(event.kind)}</mark>
                  <p>
                    <b>Token 化灵 +{event.qiGained}</b>
                    {event.tokenCount} Token 入账，时间 {formatShortTime(event.occurredAt)}。
                  </p>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </section>
    </main>
  );
}

function LedgerTag({ label, value }: { label: string; value: string }) {
  return (
    <div className="ledger-tag">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function LedgerEntry({ title, body }: { title: string; body: string }) {
  return (
    <div className="ledger-entry">
      <b>{title}</b>
      <p>{body}</p>
    </div>
  );
}

function buildingDescription(building: BuildingId, state: GameState | null) {
  if (building === 'treasure') {
    return '聚宝盆以薪火为引，凝出灵草、灵石、丹药与异宝。今日凝物次数会在新的一天重置。';
  }
  if (building === 'farm') {
    return '灵植园沿山势开作三畦，照看后可得灵草与少量灵石，是丹房的根基。';
  }
  if (building === 'alchemy') {
    return '丹房炉火三分，消耗等量灵草与灵石炼成丹药，破境前不可或缺。';
  }
  if (building === 'beast') {
    return state?.homestead.spiritBeast.status === 'traveling'
      ? `${state.homestead.spiritBeast.name}已下山，归来时会带回灵草。`
      : '灵兽可携符出游，消耗一枚灵石，半个时辰后带回山外收获。';
  }
  if (building === 'practice') {
    return '阵枢牵引外界气运，将灵池余炁转化为修为，境界越高消耗越大。';
  }
  if (building === 'meditate') {
    return '静室无须材料，闭关片刻可稳定增加灵气与修为。';
  }
  if (building === 'divination') {
    return '观星台每日可起卦，朱批会影响你对洞府事务的判断。';
  }
  return '藏经阁暂存聚宝盆凝出的异物与残卷，后续可展开鉴定、研读与装备。';
}

function buildingPapers(building: BuildingId, state: GameState | null) {
  if (building === 'treasure') {
    return [
      {
        label: '凝聚次数',
        value: `${state?.homestead.treasureBasin.dailyCondenses ?? 0} / 3`,
        body: `薪火余量 ${formatNumber(state?.player.kindling)}。`
      },
      {
        label: '上次凝物',
        value: formatShortTime(state?.homestead.treasureBasin.lastCondensedAt),
        body: state?.homestead.inventory[0] ? `最近得 ${state.homestead.inventory[0].name}。` : '盆中灵液尚未成形。'
      }
    ];
  }
  if (building === 'farm') {
    return [
      { label: '灵草', value: formatNumber(state?.player.spiritHerb), body: '炼丹主要材料。' },
      { label: '灵石', value: formatNumber(state?.player.spiritStone), body: '照看灵田也会积攒少量灵石。' }
    ];
  }
  if (building === 'alchemy') {
    return [
      { label: '可用灵草', value: formatNumber(state?.player.spiritHerb), body: '每炉消耗一份灵草。' },
      { label: '可用灵石', value: formatNumber(state?.player.spiritStone), body: '每炉消耗一枚灵石。' }
    ];
  }
  if (building === 'beast') {
    return [
      {
        label: '灵兽状态',
        value: state?.homestead.spiritBeast.status === 'traveling' ? '出游' : '待命',
        body: state?.homestead.spiritBeast.route ? `当前路线：${state.homestead.spiritBeast.route}。` : '兽栏风铃未响。'
      },
      { label: '归山时辰', value: formatShortTime(state?.homestead.spiritBeast.returnsAt), body: '到点后后台会自动结算。' }
    ];
  }
  if (building === 'practice') {
    return [
      { label: '本次消耗', value: formatNumber(state?.progression.nextPracticeCost), body: '灵池余炁会转为修为。' },
      { label: '当前修为', value: formatNumber(state?.player.cultivation), body: '积满后可服丹破境。' }
    ];
  }
  if (building === 'meditate') {
    return [
      { label: '静修收益', value: `+${6 + (state?.player.realmLevel ?? 0)}`, body: '稳定增加灵气。' },
      { label: '心境收益', value: `+${4 + (state?.player.realmLevel ?? 0)}`, body: '稳定增加修为。' }
    ];
  }
  if (building === 'divination') {
    return [
      { label: '卦象', value: state?.homestead.omen?.fortune ?? '未卜', body: state?.homestead.omen?.verse ?? '星斗未明。' },
      { label: '宜事', value: state?.homestead.omen?.favors.join('、') ?? '未批', body: '后续会用于玩法加成。' }
    ];
  }
  return [
    { label: '藏品', value: formatNumber(state?.homestead.inventory.length), body: '凝聚产物暂存于此。' },
    {
      label: '最近入库',
      value: state?.homestead.inventory[0]?.name ?? '无',
      body: state?.homestead.inventory[0]?.description ?? '阁中书香尚浅。'
    }
  ];
}

function actionButtonLabel(building: BuildingId) {
  return {
    treasure: '投入薪火凝聚',
    farm: '照看灵植园',
    alchemy: '开炉炼丹',
    beast: '派遣灵兽',
    practice: '开始修炼',
    meditate: '入定片刻',
    divination: '观星起卦',
    archive: '翻阅藏品'
  }[building];
}

function logMark(type: HomesteadLog['type']) {
  return {
    omen: '星',
    treasure: '宝',
    beast: '兽'
  }[type];
}
