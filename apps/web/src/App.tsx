import { useCallback, useEffect, useRef, useState } from 'react';
import { DRAW_COST, LEGENDARY_PITY, RARE_PITY, RARITIES, WEAPONS, weaponById, type BatchDismantleRequest, type CompanionState, type ForgeRequest, type ForgeResult, type Weapon } from '@token-game/shared';
import basinImage from '../../../desktop/pet/assets/processed/jade-basin.webp';
import { Icon } from './Icon';
import { compactNumber as number } from './format-number';
import { paintSelection } from './weapon-selection';
import { useWeaponDragSelection } from './useWeaponDragSelection';
import '../../../desktop/pet/scene.css';

type ActionResponse = { state: CompanionState; result: ForgeResult };
declare global {
  interface Window {
    tokenPet?: {
      getState: () => Promise<CompanionState>;
      collect: (observedTotal: number) => Promise<{ state: CompanionState; collectedTokens: number }>;
      draw: (request: ForgeRequest & { count: number }) => Promise<ActionResponse>;
      dismantleBatch: (request: BatchDismantleRequest) => Promise<ActionResponse>;
      exchange: (request: ForgeRequest & { weaponId: string }) => Promise<ActionResponse>;
      onState: (callback: (state: CompanionState) => void) => () => void;
      chooseDirectory: () => Promise<CompanionState | null>;
    };
  }
}
const art = import.meta.glob('../../../desktop/pet/assets/processed/weapons/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const exact = (value: number) => value.toLocaleString();
function bridge() {
  if (!window.tokenPet) throw new Error('未连接桌面进程');
  return window.tokenPet;
}
function WeaponArt({ weapon, className = '' }: { weapon: Weapon; className?: string }) {
  return <img className={'weapon-art ' + className} src={art['../../../desktop/pet/assets/processed/weapons/' + weapon.id + '.webp']} alt={weapon.name} draggable={false} />;
}
function Basin({ motion, pending }: { motion: string; pending: boolean }) {
  return <div className={'companion-scene ' + motion} data-pending={pending}>
    <div className="basin-aura" aria-hidden="true" />
    <img className="pet-image basin-image" src={basinImage} alt="青玉聚宝盆" draggable={false} />
    <div className="energy-ripple" aria-hidden="true" />
    {[0, 1, 2].map(i => <span key={i} className="energy-thread" aria-hidden="true" />)}
  </div>;
}

export default function App() {
  const [state, setState] = useState<CompanionState | null>(null);
  const [mode, setMode] = useState<'draw' | 'forge'>('draw');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const actionLock = useRef(false);
  const [celebration, setCelebration] = useState<{ tokens: number; key: number } | null>(null);
  const [selectedId, setSelectedId] = useState(WEAPONS[0]!.id);
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [batchMode, setBatchMode] = useState(false);
  const [confirm, setConfirm] = useState<{ ids: string[]; revision: number; quantity: number; shards: number; legendary: boolean } | null>(null);
  const [notice, setNotice] = useState('');
  const [effect, setEffect] = useState('');
  const [affectedIds, setAffectedIds] = useState<string[]>([]);
  const [revealKey, setRevealKey] = useState(0);
  const previousReceipt = useRef<number | null>(null);
  const applyState = useCallback((next: CompanionState) => {
    if (!next) return;
    setState(current => current && (next.totalTokens < current.totalTokens || next.acknowledgedTokens < current.acknowledgedTokens || next.forge.revision < current.forge.revision) ? current : next);
  }, []);
  const load = useCallback(async (preserveError = false) => {
    try { applyState(await bridge().getState()); if (!preserveError) setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : '暂时连接不上聚宝盆'); }
  }, [applyState]);
  useEffect(() => {
    void load();
    const unsubscribe = window.tokenPet?.onState(applyState);
    const focus = () => { void load(); };
    window.addEventListener('focus', focus);
    return () => { unsubscribe?.(); window.removeEventListener('focus', focus); };
  }, [load, applyState]);
  useEffect(() => {
    if (!state) return;
    if (previousReceipt.current !== null && state.receipt.revision > previousReceipt.current) {
      setCelebration({ tokens: state.receipt.tokens, key: state.receipt.revision });
    }
    previousReceipt.current = state.receipt.revision;
  }, [state?.receipt.revision]);
  useEffect(() => {
    if (!celebration) return;
    const timer = setTimeout(() => setCelebration(null), 2200);
    return () => clearTimeout(timer);
  }, [celebration]);
  useEffect(() => {
    if (!effect) return;
    const timer = setTimeout(() => setEffect(''), 1500);
    return () => clearTimeout(timer);
  }, [effect, revealKey]);
  const forge = state?.forge;
  const ownedIds = WEAPONS.filter(w => (forge?.inventory[w.id] ?? 0) > 0).map(w => w.id);
  const batchIds = checkedIds.filter(id => ownedIds.includes(id));
  const batchQuantity = batchIds.reduce((sum, id) => sum + forge!.inventory[id]!, 0);
  const batchShards = batchIds.reduce((sum, id) => sum + forge!.inventory[id]! * RARITIES[weaponById(id)!.tier - 1]!.salvage, 0);
  useEffect(() => { setConfirm(null); }, [forge?.revision]);
  const selection = useWeaponDragSelection(batchMode && mode === 'forge' && !busy, batchIds, (ids, select) => {
    setCheckedIds(current => paintSelection(current, ids, select));
    setConfirm(null); setNotice('');
  });
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !batchMode || busy) return;
      if (confirm) setConfirm(null);
      else { setBatchMode(false); setCheckedIds([]); }
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [batchMode, confirm, busy]);
  const pending = state?.pendingTokens ?? 0;
  const selected = weaponById(selectedId)!;
  const rarity = RARITIES[selected.tier - 1]!;
  const owned = forge?.inventory[selected.id] ?? 0;
  const lastDraw = (forge?.lastDraw ?? []).map(id => weaponById(id)!);
  const featured = [...lastDraw].sort((a, b) => b.tier - a.tier)[0] ?? WEAPONS[12]!;
  const issue = Boolean(state && ['error', 'missing', 'unsupported'].includes(state.connection.status));
  const tx = (): ForgeRequest => ({ requestId: crypto.randomUUID(), expectedRevision: state!.forge.revision });

  async function collect() {
    if (!state || actionLock.current) return;
    actionLock.current = true; setBusy('collect'); setError('');
    try {
      const result = await bridge().collect(state.totalTokens);
      applyState(result.state);
      setCelebration({ tokens: result.collectedTokens, key: Date.now() });
    } catch (e) { setError(e instanceof Error ? e.message : '收取失败'); }
    finally { actionLock.current = false; setBusy(''); }
  }
  async function action(kind: 'draw' | 'dismantle' | 'exchange', count = 1) {
    if (!state || actionLock.current || (kind === 'dismantle' && !confirm)) return;
    actionLock.current = true; setBusy(kind); setError(''); setNotice(''); setConfirm(null);
    try {
      const result = kind === 'draw' ? await bridge().draw({ ...tx(), count })
        : kind === 'dismantle' ? await bridge().dismantleBatch({ ...tx(), expectedRevision: confirm!.revision, weaponIds: confirm!.ids })
        : await bridge().exchange({ ...tx(), weaponId: selectedId });
      applyState(result.state);
      setAffectedIds(result.result.weaponIds);
      setRevealKey(key => key + 1);
      setEffect(kind === 'dismantle' ? 'is-shattering' : kind === 'exchange' ? 'is-forged' : 'is-revealing');
      if (kind === 'draw') setNotice('获得 ' + result.result.weaponIds.length + ' 把武器');
      else if (kind === 'dismantle') {
        setCheckedIds([]);
        setBatchMode(false);
        setNotice('已分解 ' + exact(result.result.quantity) + ' 把 · +' + exact(result.result.shardsDelta) + ' 玄铁');
      }
      else setNotice('已兑换 · ' + selected.name);
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : '操作未完成');
      void load(true);
    } finally { actionLock.current = false; setBusy(''); }
  }
  async function chooseDirectory() {
    if (actionLock.current) return;
    actionLock.current = true; setBusy('directory');
    try { const next = await bridge().chooseDirectory(); if (next) applyState(next); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : '目录未能连接'); }
    finally { actionLock.current = false; setBusy(''); }
  }
  function selectWeapon(id: string) { setSelectedId(id); setNotice(''); setEffect(''); }
  function checkWeapons(ids: string[]) { setCheckedIds(ids); setConfirm(null); setNotice(''); }
  function toggleBatch(active: boolean) { setBatchMode(active); checkWeapons([]); setEffect(''); }
  return <main className="app-shell">
    <header className="app-header">
      <h1>聚宝盆<span className="title-seal" aria-hidden="true">聚</span></h1>
      <div className="wallets">
        <div className="wallet"><span>可用 Token</span><strong data-testid="balance" title={exact(forge?.balance ?? 0)}>{number(forge?.balance ?? 0)}</strong></div>
        <div className="wallet material-wallet"><span>玄铁碎片</span><strong data-testid="shards" title={exact(forge?.shards ?? 0)}>{number(forge?.shards ?? 0)}</strong></div>
      </div>
    </header>
    <div className="app-body">
      <aside className="basin-pane" aria-label="Token 收获">
        <div className="section-kicker">灵气归藏</div>
        <button className="basin-touch" aria-label="收取盆中 Token" onClick={() => void collect()} disabled={Boolean(busy) || !state}>
          <Basin key={celebration?.key ?? 'idle'} motion={celebration ? celebration.tokens ? 'is-celebrating' : 'is-empty' : ''} pending={pending > 0} />
        </button>
        <div className="harvest-readout" aria-live="polite">
          <h2>{celebration ? celebration.tokens ? '灵气入藏' : '盆中暂无积累' : pending ? '灵气已汇聚' : '静候灵气'}</h2>
          <div className="harvest-count" title={exact(celebration?.tokens ?? pending)}>{celebration ? '+' : ''}{number(celebration?.tokens ?? pending)}</div>
          <span className="count-unit">TOKEN {celebration ? '已收取' : '待收取'}</span>
        </div>
        <button className="collect-button" disabled={Boolean(busy) || !state} onClick={() => void collect()}><Icon name="Sparkles" />{busy === 'collect' ? '正在收取' : '收取灵气'}</button>
        <dl className="totals">
          <div><dt>今日汇聚</dt><dd title={exact(state?.todayTokens ?? 0)}>{number(state?.todayTokens ?? 0)}</dd></div>
          <div><dt>累计汇聚</dt><dd title={exact(state?.totalTokens ?? 0)}>{number(state?.totalTokens ?? 0)}</dd></div>
        </dl>
        <div className="collection-count"><span>武器收集</span><strong>{Object.keys(forge?.inventory ?? {}).length}<small> / 15</small></strong></div>
      </aside>

      <section className="workbench" aria-label="武器">
        <div className="workbench-bar">
          <div className="mode-tabs" role="tablist" aria-label="武器功能">
            <button role="tab" aria-selected={mode === 'draw'} onClick={() => { setMode('draw'); toggleBatch(false); }}><Icon name="Swords" />祈器</button>
            <button role="tab" aria-selected={mode === 'forge'} onClick={() => { setMode('forge'); setNotice(''); }}><Icon name="Hammer" />分解 · 兑换</button>
          </div>
          <details className="odds">
            <summary aria-label="查看概率与保底" title="概率与保底"><Icon name="Info" /></summary>
            <div className="odds-popover">
              <strong>基础概率</strong>
              {RARITIES.map(r => <div key={r.tier} className={'odds-row tier-' + r.tier}><span>{r.name}</span><b>{r.chance}%</b></div>)}
              <p>每档 3 把，档内等概率。</p><p>连续 {RARE_PITY} 抽至少一把上品及以上；{LEGENDARY_PITY} 抽至少一把仙品。提前获得即重置对应保底，单抽与十连共享计数。</p>
              <p>兑换不改变保底。Token 仅来自已收取的本机用量。</p>
            </div>
          </details>
        </div>

        {mode === 'draw' ? <div className="draw-panel" role="tabpanel" aria-label="祈器">
          <div key={revealKey} className={'weapon-showcase tier-' + featured.tier + ' ' + (effect === 'is-revealing' ? effect : '')}>
            <div className="showcase-label"><span>{lastDraw.length ? '本次祈得' : '仙器谱'}</span><b>{RARITIES[featured.tier - 1]!.name}</b></div>
            <WeaponArt weapon={featured} />
            <h2>{featured.name}</h2>
            <div className="reveal-lines" aria-hidden="true" />
          </div>
          <div className="draw-controls">
            <button className="secondary-button" title={exact(DRAW_COST) + ' Token'} disabled={Boolean(busy) || (forge?.balance ?? 0) < DRAW_COST} onClick={() => void action('draw', 1)}><Icon name="Sparkles" /><span>祈器一次<small>{number(DRAW_COST)} Token</small></span></button>
            <button className="primary-button ten-draw-button" title={exact(DRAW_COST * 10) + ' Token'} disabled={Boolean(busy) || (forge?.balance ?? 0) < DRAW_COST * 10} onClick={() => void action('draw', 10)}><Icon name="Swords" /><span>祈器十次<small>{number(DRAW_COST * 10)} Token</small></span></button>
          </div>
          <div className="pity-row">
            <div><span>上品保底</span><b>{forge?.sinceRare ?? 0} / {RARE_PITY}</b><progress max={RARE_PITY} value={forge?.sinceRare ?? 0} /></div>
            <div><span>仙品保底</span><b>{forge?.sinceLegendary ?? 0} / {LEGENDARY_PITY}</b><progress max={LEGENDARY_PITY} value={forge?.sinceLegendary ?? 0} /></div>
          </div>
          <div className="recent-heading"><h3>最近祈得</h3><span aria-live="polite">{notice || (forge?.draws ? '累计 ' + exact(forge.draws) + ' 抽' : '')}</span></div>
          <div className="recent-grid">
            {lastDraw.length ? lastDraw.map((weapon, index) => <button key={index} className={'recent-weapon tier-' + weapon.tier} title={RARITIES[weapon.tier - 1]!.name + ' · ' + weapon.name} onClick={() => { selectWeapon(weapon.id); setMode('forge'); }}>
              <WeaponArt weapon={weapon} /><span>{weapon.name}</span><i aria-hidden="true" />
            </button>) : <div className="empty-recent">暂无祈器记录</div>}
          </div>
        </div> : <div className={'forge-panel' + (batchMode ? ' is-batch-mode' : '')} role="tabpanel" aria-label="分解与兑换">
          {batchMode && <div className="forge-toolbar">
            <button className="text-button select-all-button" disabled={Boolean(busy) || !ownedIds.length} onClick={() => checkWeapons(batchIds.length === ownedIds.length ? [] : ownedIds)}>{batchIds.length === ownedIds.length && ownedIds.length ? '取消全选' : '全选'}</button>
            <select aria-label="品质快捷选择" value="" disabled={Boolean(busy) || !ownedIds.length} onChange={event => checkWeapons(ownedIds.filter(id => weaponById(id)!.tier <= Number(event.target.value)))}>
              <option value="" disabled>按品质选择</option>
              <option value="1">仅选凡品</option>
              <option value="2">仅选凡品、良品</option>
              <option value="3">仅选凡品、良品、上品</option>
            </select>
            <span aria-live="polite">已选 {batchIds.length} 种 · {exact(batchQuantity)} 把</span>
          </div>}
          <div className="rarity-heading">{RARITIES.map(r => <span key={r.tier} className={'tier-' + r.tier}>{r.name}</span>)}</div>
          <div className={'weapon-grid' + (batchMode ? ' is-selecting' : '') + (selection.dragging ? ' is-drag-selecting' : '')} {...selection.handlers} onContextMenu={event => { if (batchMode) event.preventDefault(); }}>
            {(['sword', 'saber', 'spear'] as const).flatMap(kind => WEAPONS.filter(w => w.kind === kind)).map(weapon =>
              <div key={weapon.id} className={'weapon-cell tier-' + weapon.tier + (!batchMode && selectedId === weapon.id ? ' is-selected' : '') + (batchMode && batchIds.includes(weapon.id) ? ' is-checked' : '') + (!(forge?.inventory[weapon.id]) ? ' is-unowned' : '')}>
                <button data-weapon-id={weapon.id} className={'weapon-inspect ' + (effect === 'is-shattering' && affectedIds.includes(weapon.id) ? effect : '')} role={batchMode ? 'checkbox' : undefined} aria-checked={batchMode ? batchIds.includes(weapon.id) : undefined} aria-pressed={batchMode ? undefined : selectedId === weapon.id} aria-label={(batchMode ? '分解全部' : '') + weapon.name + '，拥有 ' + (forge?.inventory[weapon.id] ?? 0) + ' 把'} disabled={batchMode && (Boolean(busy) || !(forge?.inventory[weapon.id]))} onClick={event => {
                  if (!batchMode) selectWeapon(weapon.id);
                  else if (event.detail === 0) checkWeapons(paintSelection(batchIds, [weapon.id], !batchIds.includes(weapon.id)));
                }}>
                  <span className="owned-count">×{forge?.inventory[weapon.id] ?? 0}</span><WeaponArt weapon={weapon} /><span className="weapon-name">{weapon.name}</span>
                  {batchMode && batchIds.includes(weapon.id) && <span className="selection-mark" aria-hidden="true"><Icon name="Check" size={28} /></span>}
                </button>
              </div>)}
          </div>
          <div className={'forge-selection tier-' + selected.tier + ' ' + (effect !== 'is-shattering' || affectedIds.includes(selectedId) ? effect : '')} key={selectedId}>
            <WeaponArt weapon={selected} />
            <div className="selected-info"><h3>{selected.name}<span>{rarity.name}</span></h3><p>拥有 {owned} 把 · 分解 +{rarity.salvage} 玄铁 / 把</p></div>
            <span className="forge-notice" aria-live="polite">{notice}</span>
          </div>
          <div className="forge-actions">
            {confirm ? <div className="confirm-dismantle" role="alert"><span>分解所选 {confirm.ids.length} 种全部 {exact(confirm.quantity)} 把{confirm.legendary ? '（含仙品）' : ''}，获得 {exact(confirm.shards)} 玄铁？</span><button className="text-button" onClick={() => setConfirm(null)}>取消</button><button className="danger-button" disabled={Boolean(busy)} onClick={() => void action('dismantle')}>确认分解</button></div>
              : batchMode ? <><button className="secondary-button exit-selection-button" disabled={Boolean(busy)} onClick={() => toggleBatch(false)}><Icon name="X" />退出选择</button>
                <button className="primary-button dismantle-button" disabled={Boolean(busy) || !batchIds.length} onClick={() => setConfirm({ ids: batchIds, revision: forge!.revision, quantity: batchQuantity, shards: batchShards, legendary: batchIds.some(id => weaponById(id)!.tier === 5) })}><Icon name="Hammer" /><span>分解所选 · {exact(batchQuantity)} 把<small>+{exact(batchShards)} 玄铁</small></span></button></>
              : <><button className="secondary-button batch-entry-button" disabled={Boolean(busy) || !ownedIds.length} onClick={() => toggleBatch(true)}><Icon name="Hammer" />批量分解</button>
                <button className="primary-button exchange-button" disabled={Boolean(busy) || (forge?.shards ?? 0) < rarity.exchange} onClick={() => void action('exchange')}><Icon name="ArrowRightLeft" /><span>兑换此武器<small>{exact(rarity.exchange)} 玄铁</small></span></button></>}
          </div>
        </div>}
      </section>
    </div>
    <footer className="app-footer">
      <span className={'connection-status ' + (issue ? 'is-warning' : '')}><i />Codex<span className="connection-message">{state?.connection.message ?? '正在连接'}</span></span>
      {error && <span className="error-message" role="alert">{error}</span>}
      <details className="connection-details">
        <summary title="Codex 日志目录">连接<Icon name="ChevronDown" size={13} /></summary>
        <div className="directory-popover"><strong>Codex 日志目录</strong><p>{state?.connection.directory}</p><button className="text-button" disabled={Boolean(busy)} onClick={() => void chooseDirectory()}>选择文件夹</button>
          {state?.connection.recovered && <p>已从备份恢复进度</p>}
          {Boolean(state?.legacyTokens) && <p>旧版累计 {exact(state!.legacyTokens)} Token · 单独保留</p>}
        </div>
      </details>
    </footer>
  </main>;
}
