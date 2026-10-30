import assert from 'node:assert/strict';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { test } from 'node:test';
import { CodexCollector, localDate } from './collector';

const line = (value: unknown) => JSON.stringify(value) + '\n';
const meta = (id = 'session-a', extra = {}) => line({ type: 'session_meta', timestamp: '2026-10-29T00:00:00Z', payload: { id, ...extra } });
const usage = (total: number, timestamp = '2026-10-29T01:01:00Z') => line({ type: 'event_msg', timestamp, payload: { type: 'token_count', info: { total_token_usage: { input_tokens: total - 10, cached_input_tokens: 500, output_tokens: 10, reasoning_output_tokens: 7, total_tokens: total }, last_token_usage: { total_tokens: 99999 } } } });

function setup(t: { after: (fn: () => unknown) => void }) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'token-companion-'));
  const codexHome = path.join(root, 'codex');
  const dataDir = path.join(root, 'data');
  mkdirSync(path.join(codexHome, 'sessions'), { recursive: true });
  const file = path.join(codexHome, 'sessions', 'rollout-a.jsonl');
  let now = new Date('2026-10-29T01:00:00Z');
  const options = { codexHome, dataDir, now: () => now };
  const collector = new CodexCollector(options);
  t.after(async () => { await collector.close(); rmSync(root, { recursive: true, force: true }); });
  return { root, codexHome, dataDir, file, options, collector, advance: () => { now = new Date('2026-10-29T02:00:00Z'); } };
}

test('baselines history, uses only cumulative total, deduplicates repeated snapshots and parallel scans', async t => {
  const s = setup(t);
  writeFileSync(s.file, meta() + usage(1000, '2026-10-29T00:59:00Z'));
  await s.collector.scan();
  assert.equal(s.collector.state().totalTokens, 0);
  s.advance();
  appendFileSync(s.file, usage(1400) + usage(1400));
  await Promise.all([s.collector.scan(), s.collector.scan(), s.collector.scan()]);
  assert.equal(s.collector.state().totalTokens, 400);
  assert.equal(s.collector.state().pendingTokens, 400);
  assert.equal(s.collector.state().todayTokens, 400);
});

test('restart catches up, archive moves and duplicate session files never pay twice', async t => {
  const s = setup(t);
  writeFileSync(s.file, meta() + usage(100, '2026-10-29T00:59:00Z'));
  await s.collector.scan(); s.advance();
  appendFileSync(s.file, usage(300)); await s.collector.scan(); await s.collector.close();
  const archived = path.join(s.codexHome, 'archived_sessions'); mkdirSync(archived);
  const moved = path.join(archived, 'rollout-a.jsonl'); renameSync(s.file, moved);
  appendFileSync(moved, usage(500, '2026-10-29T01:02:00Z'));
  copyFileSync(moved, s.file);
  const restarted = new CodexCollector(s.options);
  await restarted.scan();
  assert.equal(restarted.state().totalTokens, 400);
  await restarted.close();
});

test('forks baseline copied history while independent child sessions accumulate separately', async t => {
  const s = setup(t); s.advance();
  writeFileSync(s.file, meta() + usage(300));
  await s.collector.scan();
  writeFileSync(path.join(s.codexHome, 'sessions', 'rollout-b.jsonl'), meta('fork-b', { forked_from_id: 'session-a', timestamp: '2026-10-29T01:10:00Z' }) + usage(300) + usage(370, '2026-10-29T01:11:00Z'));
  writeFileSync(path.join(s.codexHome, 'sessions', 'rollout-c.jsonl'), meta('child-c', { parent_thread_id: 'session-a' }) + usage(90));
  await s.collector.scan();
  assert.equal(s.collector.state().totalTokens, 460);
});

test('partial UTF-8 lines, replacement and cumulative regression preserve accepted high-water marks', async t => {
  const s = setup(t); s.advance();
  writeFileSync(s.file, meta() + usage(100));
  await s.collector.scan();
  const next = usage(150).trimEnd();
  appendFileSync(s.file, next.slice(0, -3)); await s.collector.scan();
  assert.equal(s.collector.state().totalTokens, 100);
  appendFileSync(s.file, next.slice(-3) + '\n'); await s.collector.scan();
  assert.equal(s.collector.state().totalTokens, 150);
  writeFileSync(s.file, meta() + line({ type: 'response_item', payload: { text: '中文文本' } }) + usage(30, '2026-10-29T01:02:00Z'));
  await s.collector.scan();
  assert.equal(s.collector.state().totalTokens, 150);
  assert.equal(s.collector.state().connection.status, 'unsupported');
  appendFileSync(s.file, usage(180, '2026-10-29T01:03:00Z')); await s.collector.scan();
  assert.equal(s.collector.state().totalTokens, 180);
});

test('collect confirms the displayed snapshot, retains new arrivals, and is idempotent', async t => {
  const s = setup(t); s.advance(); writeFileSync(s.file, meta() + usage(100));
  await s.collector.scan();
  appendFileSync(s.file, usage(170)); await s.collector.scan();
  const result = await s.collector.acknowledge(100);
  assert.equal(result.collectedTokens, 100);
  assert.equal(result.state.pendingTokens, 70);
  const duplicate = await s.collector.acknowledge(100);
  assert.equal(duplicate.collectedTokens, 0);
  assert.equal(duplicate.state.receipt.revision, 1);
  await assert.rejects(s.collector.acknowledge(171));
  await assert.rejects(s.collector.acknowledge(-1));
});

test('an older archive copy does not mark an active session as a cumulative reset', async t => {
  const s = setup(t); s.advance();
  writeFileSync(s.file, meta() + usage(100)); await s.collector.scan();
  const archived = path.join(s.codexHome, 'archived_sessions'); mkdirSync(archived);
  copyFileSync(s.file, path.join(archived, 'rollout-old.jsonl'));
  appendFileSync(s.file, usage(200, '2026-10-29T01:02:00Z'));
  await s.collector.scan();
  assert.equal(s.collector.state().totalTokens, 200);
  assert.equal(s.collector.state().connection.status, 'connected');
});

test('write failure does not advance memory or cursor, backup recovery replays the missing increment', async t => {
  const s = setup(t); s.advance(); writeFileSync(s.file, meta() + usage(100));
  const commit = s.collector.store.commit.bind(s.collector.store);
  s.collector.store.commit = () => { throw new Error('injected disk failure'); };
  await s.collector.scan();
  assert.equal(s.collector.state().totalTokens, 0);
  assert.equal(s.collector.state().connection.status, 'error');
  s.collector.store.commit = commit; await s.collector.scan();
  assert.equal(s.collector.state().totalTokens, 100);
  appendFileSync(s.file, usage(160)); await s.collector.scan();
  writeFileSync(s.collector.store.file, '{interrupted');
  const restored = new CodexCollector(s.options);
  assert.equal(restored.state().connection.recovered, true);
  await restored.scan();
  assert.equal(restored.state().totalTokens, 160);
  await restored.close();
});

test('unknown formats do not partially commit a file and malformed records remain recoverable', async t => {
  const s = setup(t); s.advance();
  writeFileSync(s.file, meta() + usage(100) + line({ type: 'event_msg', timestamp: '2026-10-29T01:01:00Z', payload: { type: 'token_count', info: { last_token_usage: { total_tokens: 10 } } } }));
  await s.collector.scan();
  assert.equal(s.collector.state().connection.status, 'unsupported');
  assert.equal(s.collector.state().totalTokens, 0);
  writeFileSync(s.file, meta() + usage(100)); await s.collector.scan();
  assert.equal(s.collector.state().totalTokens, 100);
  appendFileSync(s.file, '{bad}\n'); await s.collector.scan();
  assert.equal(s.collector.state().totalTokens, 100);
  assert.equal(s.collector.state().connection.status, 'unsupported');
});

test('directory changes retain totals and deduplication, and history belongs to its event date', async t => {
  const s = setup(t); s.advance(); writeFileSync(s.file, meta() + usage(100));
  await s.collector.scan();
  const other = path.join(s.root, 'other'); mkdirSync(path.join(other, 'archived_sessions'), { recursive: true });
  copyFileSync(s.file, path.join(other, 'archived_sessions', 'rollout-copy.jsonl'));
  await s.collector.setDirectory(other);
  assert.equal(s.collector.state().totalTokens, 100);
  assert.equal(s.collector.state().connection.directory, other);
  const raw = JSON.parse(readFileSync(s.collector.store.file, 'utf8'));
  assert.equal(raw.daily[localDate(new Date('2026-10-29T01:01:00Z'))], 100);
});

test('migrates legacy total as separate provenance and preserves original resources', async t => {
  const s = setup(t);
  const legacy = path.join(s.root, 'legacy'); mkdirSync(legacy);
  const original = { player: { totalTokens: 8765, qi: 99 }, events: [] };
  writeFileSync(path.join(legacy, 'ledger.json'), JSON.stringify(original));
  const collector = new CodexCollector({ ...s.options, dataDir: legacy });
  assert.equal(collector.state().legacyTokens, 8765);
  assert.equal(collector.state().totalTokens, 0);
  assert.equal(collector.state().pendingTokens, 0);
  assert.ok(existsSync(path.join(legacy, 'ledger.json.pre-companion.bak')));
  assert.deepEqual(JSON.parse(readFileSync(path.join(legacy, 'ledger.json'), 'utf8')), original);
  await collector.close();
});
