import { useEffect, useState } from 'react';
import type { TokenEvent } from '@token-game/shared';

type GameState = {
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

export default function App() {
  const [state, setState] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
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
        }
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message);
        }
      }
    }

    void loadState();
    const timer = window.setInterval(() => {
      void loadState();
    }, 3000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  async function runAction(action: 'burst' | 'upgrade') {
    const endpoint =
      action === 'burst' ? `${apiBase}/api/actions/burst` : `${apiBase}/api/upgrades/processor`;

    try {
      setBusyAction(action);
      const response = await fetch(endpoint, { method: 'POST' });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? '操作失败');
      }

      setState(data as GameState);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <p className="eyebrow">挂机资源循环</p>
        <h1>用 Token 喂猫</h1>
        <p className="lede">
          你的 Token 活动会转化为猫粮。消耗猫粮升级处理器，让每次自动或手动产出的收益更高，同时挂机循环会持续在后台推进。
        </p>
      </section>

      <section className="grid">
        <article className="panel stat-panel">
          <span className="label">小猫</span>
          <strong>{state?.player.kittenName ?? '加载中...'}</strong>
        </article>

        <article className="panel stat-panel accent">
          <span className="label">猫粮</span>
          <strong>{state?.player.food ?? '--'}</strong>
        </article>

        <article className="panel stat-panel">
          <span className="label">已追踪 Token</span>
          <strong>{state?.player.totalTokens ?? '--'}</strong>
        </article>

        <article className="panel stat-panel">
          <span className="label">上次喂食</span>
          <strong>{state?.player.lastFedAt ? new Date(state.player.lastFedAt).toLocaleTimeString() : '--'}</strong>
        </article>

        <article className="panel action-panel">
          <div className="panel-header">
            <span className="label">操作</span>
            <span>挂机周期 {Math.round((state?.progression.passiveIntervalMs ?? 5000) / 1000)} 秒</span>
          </div>
          <button disabled={busyAction !== null} onClick={() => void runAction('burst')} type="button">
            {busyAction === 'burst' ? '处理中...' : '处理一轮 Token 爆发'}
          </button>
          <button
            className="secondary"
            disabled={busyAction !== null || (state?.player.food ?? 0) < (state?.progression.nextProcessorCost ?? 0)}
            onClick={() => void runAction('upgrade')}
            type="button"
          >
            {busyAction === 'upgrade'
              ? '升级中...'
              : `升级处理器（${state?.progression.nextProcessorCost ?? '--'} 猫粮）`}
          </button>
        </article>

        <article className="panel progression-panel">
          <div className="panel-header">
            <span className="label">成长</span>
            <span>升级循环</span>
          </div>
          <div className="progress-row">
            <span>处理器等级</span>
            <strong>{state?.player.processorLevel ?? '--'}</strong>
          </div>
          <div className="progress-row">
            <span>累计消耗猫粮</span>
            <strong>{state?.player.lifetimeFoodSpent ?? '--'}</strong>
          </div>
          <p className="hint">每提升 1 级处理器，所有自动和手动的 Token 事件都会额外获得 +2 猫粮。</p>
        </article>

        <article className="panel log-panel">
          <div className="panel-header">
            <span className="label">Token 事件</span>
            <span>{state?.events.length ?? 0} 条记录</span>
          </div>
          {error ? <p className="error">{error}</p> : null}
          <ul>
            {state?.events.map((event) => (
              <li key={event.id}>
                <span>
                  {event.kind} 类 +{event.foodGained} 猫粮
                </span>
                <strong>{event.tokenCount} Token</strong>
              </li>
            ))}
          </ul>
        </article>
      </section>
    </main>
  );
}
