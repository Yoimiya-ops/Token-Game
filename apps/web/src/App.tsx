import { useEffect, useMemo, useState } from 'react';
import type { CultivationPage, TokenEvent } from '@token-game/shared';

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
  };
  progression: {
    nextPracticeCost: number;
    nextBreakthroughCost: number;
    passiveIntervalMs: number;
  };
  events: Array<TokenEvent & { qiGained: number }>;
};

type ActionId = 'burst' | 'practice' | 'farm' | 'meditate' | 'alchemy' | 'breakthrough';

const tabs: Array<{ id: CultivationPage; label: string; subtitle: string }> = [
  { id: 'practice', label: '修炼', subtitle: '引灵入体' },
  { id: 'farm', label: '种田', subtitle: '灵田生息' },
  { id: 'meditate', label: '打坐', subtitle: '静心入定' },
  { id: 'alchemy', label: '炼丹', subtitle: '丹炉开火' }
];

const loadingCopy: Record<CultivationPage | 'burst', string> = {
  practice: '正在引灵入体……',
  farm: '正在唤醒灵田阵法……',
  meditate: '正在铺开蒲团……',
  alchemy: '正在预热丹炉……',
  burst: '正在观测外界气运……'
};

export function shouldShowTianjiOverlay(state: { isLoading: boolean; isTransitioning: boolean }) {
  return state.isLoading || state.isTransitioning;
}

function formatNumber(value: number | undefined) {
  return typeof value === 'number' ? value.toLocaleString('zh-CN') : '--';
}

function eventLabel(kind: TokenEvent['kind']) {
  return {
    input: '入息',
    cached: '藏息',
    output: '吐纳',
    reasoning: '悟道'
  }[kind];
}

export default function App() {
  const [state, setState] = useState<GameState | null>(null);
  const [activePage, setActivePage] = useState<CultivationPage>('practice');
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<ActionId | null>(null);
  const [transitionCopy, setTransitionCopy] = useState('正在读取天机……');
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
          window.setTimeout(() => setIsTransitioning(false), 500);
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

  const realmProgress = useMemo(() => {
    if (!state) {
      return 0;
    }
    return Math.min(100, Math.round((state.player.cultivation / state.progression.nextBreakthroughCost) * 100));
  }, [state]);

  function switchPage(page: CultivationPage) {
    if (page === activePage) {
      return;
    }

    setTransitionCopy(loadingCopy[page]);
    setIsTransitioning(true);
    window.setTimeout(() => {
      setActivePage(page);
      setIsTransitioning(false);
    }, 720);
  }

  async function runAction(action: ActionId) {
    const endpoint =
      action === 'burst'
        ? `${apiBase}/api/actions/burst`
        : action === 'breakthrough'
          ? `${apiBase}/api/actions/breakthrough`
          : `${apiBase}/api/actions/${action}`;

    try {
      setBusyAction(action);
      setTransitionCopy(action === 'burst' ? loadingCopy.burst : loadingCopy[activePage]);
      setIsTransitioning(true);
      const response = await fetch(endpoint, { method: 'POST' });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? '法阵运转失败');
      }

      setState(data as GameState);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyAction(null);
      window.setTimeout(() => setIsTransitioning(false), 520);
    }
  }

  const resources = [
    ['灵气', state?.player.qi],
    ['修为', state?.player.cultivation],
    ['灵石', state?.player.spiritStone],
    ['灵草', state?.player.spiritHerb],
    ['丹药', state?.player.pills]
  ] as const;

  return (
    <main className="cultivation-shell">
      {shouldShowTianjiOverlay({ isLoading: !state, isTransitioning }) ? (
        <div className="tianji-overlay" role="status" aria-live="polite">
          <div className="tianji-ring" />
          <p>{transitionCopy}</p>
          <span>灵机流转，洞府禁制正在校准</span>
        </div>
      ) : null}

      <header className="topbar">
        <div>
          <span className="eyebrow">Token Game 洞府</span>
          <h1>云栖小筑</h1>
        </div>
        <button className="sync-button" disabled={busyAction !== null} onClick={() => void runAction('burst')} type="button">
          {busyAction === 'burst' ? '观测中...' : '读取天机'}
        </button>
      </header>

      <aside className="character-panel">
        <span className="eyebrow">本命桌宠</span>
        <div className="avatar-orb">
          <span>{state?.player.realm.slice(0, 2) ?? '修'}</span>
        </div>
        <h2>{state?.player.kittenName ?? '洞府灵伴'}</h2>
        <p>{state?.player.realm ?? '读取境界中'}</p>
        <div className="realm-meter">
          <div style={{ width: `${realmProgress}%` }} />
        </div>
        <small>
          突破进度 {realmProgress}% · 下次突破 {formatNumber(state?.progression.nextBreakthroughCost)} 修为
        </small>
        <button
          className="secondary-button"
          disabled={
            busyAction !== null ||
            !state ||
            state.player.cultivation < state.progression.nextBreakthroughCost ||
            state.player.pills < 1
          }
          onClick={() => void runAction('breakthrough')}
          type="button"
        >
          服丹突破
        </button>
      </aside>

      <section className="stage-panel">
        <nav className="cultivation-tabs" aria-label="洞府功能">
          {tabs.map((tab) => (
            <button
              className={tab.id === activePage ? 'is-active' : ''}
              key={tab.id}
              onClick={() => switchPage(tab.id)}
              type="button"
            >
              <strong>{tab.label}</strong>
              <span>{tab.subtitle}</span>
            </button>
          ))}
        </nav>

        <ActivityPage
          activePage={activePage}
          busyAction={busyAction}
          state={state}
          onAction={(action) => void runAction(action)}
        />
      </section>

      <aside className="resource-rail">
        <span className="eyebrow">洞府资源</span>
        {resources.map(([label, value]) => (
          <div className="resource-row" key={label}>
            <span>{label}</span>
            <strong>{formatNumber(value)}</strong>
          </div>
        ))}
        <div className="omen-card">
          <span>今日天机</span>
          <strong>{formatNumber(state?.player.totalTokens)} Token</strong>
          <p>{state?.player.lastFedAt ? `上次入账 ${new Date(state.player.lastFedAt).toLocaleTimeString()}` : '尚未观测到外界气运'}</p>
        </div>
        {error ? <p className="error">{error}</p> : null}
      </aside>

      <footer className="activity-log">
        <div>
          <span className="eyebrow">洞府札记</span>
          <strong>{state?.events.length ?? 0} 条天机记录</strong>
        </div>
        <ul>
          {state?.events.length ? (
            state.events.map((event) => (
              <li key={event.id}>
                <span>{eventLabel(event.kind)}化灵 +{event.qiGained}</span>
                <strong>{event.tokenCount} Token</strong>
              </li>
            ))
          ) : (
            <li>
              <span>暂无天机入账，先打坐稳住道心。</span>
              <strong>待观测</strong>
            </li>
          )}
        </ul>
      </footer>
    </main>
  );
}

function ActivityPage({
  activePage,
  busyAction,
  state,
  onAction
}: {
  activePage: CultivationPage;
  busyAction: ActionId | null;
  state: GameState | null;
  onAction: (action: ActionId) => void;
}) {
  if (activePage === 'farm') {
    return (
      <article className="activity-card farm-scene">
        <span className="eyebrow">灵田</span>
        <h2>灵田晨露凝结，适合播种采收</h2>
        <p>每次照看灵田可获得灵草与少量灵石。灵草是炼丹的主要材料。</p>
        <div className="field-grid">
          {Array.from({ length: 9 }).map((_, index) => (
            <span key={index} />
          ))}
        </div>
        <button disabled={busyAction !== null} onClick={() => onAction('farm')} type="button">
          照看灵田
        </button>
      </article>
    );
  }

  if (activePage === 'meditate') {
    return (
      <article className="activity-card meditate-scene">
        <span className="eyebrow">打坐</span>
        <h2>蒲团已暖，闭目可得稳定修为</h2>
        <p>打坐不需要材料，适合在资源不足时积累灵气和修为。</p>
        <div className="meditation-ring">定</div>
        <button disabled={busyAction !== null} onClick={() => onAction('meditate')} type="button">
          入定片刻
        </button>
      </article>
    );
  }

  if (activePage === 'alchemy') {
    return (
      <article className="activity-card alchemy-scene">
        <span className="eyebrow">炼丹</span>
        <h2>炉火三分，灵草入炉可成丹</h2>
        <p>炼丹会消耗等量灵草与灵石，产出的丹药可用于突破境界。</p>
        <div className="furnace">
          <span />
        </div>
        <button disabled={busyAction !== null || !state?.player.spiritHerb || !state?.player.spiritStone} onClick={() => onAction('alchemy')} type="button">
          开炉炼丹
        </button>
      </article>
    );
  }

  return (
    <article className="activity-card practice-scene">
      <span className="eyebrow">修炼</span>
      <h2>引灵入体，淬炼根骨</h2>
      <p>消耗灵气转换为修为。外界气运越旺，洞府灵气越足。</p>
      <div className="practice-status">
        <span>本次消耗</span>
        <strong>{formatNumber(state?.progression.nextPracticeCost)} 灵气</strong>
      </div>
      <button disabled={busyAction !== null || !state || state.player.qi < state.progression.nextPracticeCost} onClick={() => onAction('practice')} type="button">
        开始修炼
      </button>
    </article>
  );
}
