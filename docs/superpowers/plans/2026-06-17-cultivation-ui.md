# 修仙版游戏界面 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the current token-feeding game window into a cultivation-themed dashboard with 修炼、种田、打坐、炼丹, backed by a shared cultivation state and a `天机读取` loading overlay.

**Architecture:** Keep the Electron desktop shell and embedded Fastify server. Move the game economy into a cultivation domain with shared state helpers in `packages/shared`, server-owned resource updates in `apps/server`, and a reworked React UI in `apps/web` that renders a persistent hull plus four tabbed activity pages. The desktop pet launcher stays as-is; this plan only changes the game window experience and the server state it reads.

**Tech Stack:** Electron 37, Fastify 5, React 19, Vite 7, TypeScript 5, Node.js `node:test`, `tsx --test`, CSS.

---

## File Structure

- `packages/shared/src/cultivation.ts`: shared cultivation types and resource math.
- `packages/shared/src/index.ts`: export cultivation helpers alongside token event helpers.
- `packages/shared/src/cultivation.test.ts`: pure function tests for resource conversion and action costs.
- `apps/server/src/store.ts`: persisted cultivation state and action mutations.
- `apps/server/src/index.ts`: HTTP routes for the cultivation state and actions.
- `apps/server/src/cultivation.test.ts`: server-side tests for state and action behavior.
- `apps/server/src/index.test.ts`: route regression tests.
- `apps/web/src/App.tsx`: cultivation dashboard shell and page switching.
- `apps/web/src/App.js`: generated output mirror if required by existing build flow.
- `apps/web/src/styles.css`: layout, palette, loading overlay, and page styling.
- `apps/web/src/components/*`: optional split-out UI pieces if `App.tsx` grows too large.
- `README.md`, `docs/player-guide.md`, `docs/api.md`: update player-facing docs if route names or labels change.

## Task 1: Define the Cultivation Domain Model

**Files:**
- Create: `packages/shared/src/cultivation.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `packages/shared/src/cultivation.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/shared/src/cultivation.test.ts` should pin the new resource and action math:

```ts
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getPracticeCost,
  getAlchemyYield,
  normalizeCultivationState,
  tokenEventToQi
} from './cultivation';

test('converts token events into qi', () => {
  assert.equal(tokenEventToQi(1000), 10);
});

test('calculates practice cost by realm', () => {
  assert.equal(getPracticeCost(0), 12);
  assert.equal(getPracticeCost(2), 48);
});

test('normalizes missing cultivation state', () => {
  assert.deepEqual(normalizeCultivationState(undefined), {
    realm: '炼气一层',
    qi: 0,
    spiritStone: 0,
    spiritHerb: 0,
    pills: 0,
    cultivation: 0,
    currentPage: 'practice'
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run:

```bash
corepack pnpm test:desktop
corepack pnpm test
```

Expected: `packages/shared/src/cultivation.test.ts` does not exist or fails because the helpers are missing.

- [ ] **Step 3: Implement the shared helpers**

Create `packages/shared/src/cultivation.ts` with:

```ts
export type CultivationPage = 'practice' | 'farm' | 'meditate' | 'alchemy';

export type CultivationState = {
  realm: string;
  qi: number;
  spiritStone: number;
  spiritHerb: number;
  pills: number;
  cultivation: number;
  currentPage: CultivationPage;
};

export function tokenEventToQi(tokenCount: number) {
  return Math.max(0, Math.floor(tokenCount / 100));
}

export function getPracticeCost(realmLevel: number) {
  return 12 * 2 ** realmLevel;
}

export function getAlchemyYield(spiritHerb: number, spiritStone: number) {
  return Math.min(spiritHerb, spiritStone);
}

export function normalizeCultivationState(value: Partial<CultivationState> | undefined): CultivationState {
  return {
    realm: value?.realm ?? '炼气一层',
    qi: value?.qi ?? 0,
    spiritStone: value?.spiritStone ?? 0,
    spiritHerb: value?.spiritHerb ?? 0,
    pills: value?.pills ?? 0,
    cultivation: value?.cultivation ?? 0,
    currentPage: value?.currentPage ?? 'practice'
  };
}
```

- [ ] **Step 4: Re-run the test and make sure it passes**

Run:

```bash
corepack pnpm test
```

Expected: shared cultivation tests pass with 0 failures.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/index.ts packages/shared/src/cultivation.ts packages/shared/src/cultivation.test.ts
git commit -m "feat: add cultivation domain helpers"
```

---

## Task 2: Move Server State to Cultivation Resources

**Files:**
- Modify: `apps/server/src/store.ts`
- Modify: `apps/server/src/index.ts`
- Create: `apps/server/src/cultivation.test.ts`
- Modify: `apps/server/src/index.test.ts`

- [ ] **Step 1: Write failing tests**

`apps/server/src/cultivation.test.ts` should assert that the server starts with cultivation state and applies actions:

```ts
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createCultivationLedger, practiceOnce, runAlchemy } from './store';

test('creates cultivation ledger with default values', () => {
  const ledger = createCultivationLedger();
  assert.equal(ledger.player.realm, '炼气一层');
  assert.equal(ledger.player.qi, 0);
});

test('consumes qi when practicing', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'token-game-cultivation-'));
  const ledger = createCultivationLedger();
  ledger.player.qi = 20;

  const result = practiceOnce(ledger);

  assert.equal(result, true);
  assert.equal(ledger.player.cultivation > 0, true);
  rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run:

```bash
corepack pnpm test
```

Expected: missing cultivation store helpers or old server state shape failure.

- [ ] **Step 3: Implement the minimal server state**

Update `apps/server/src/store.ts` so the persisted player state includes:

```ts
player: {
  realm: string;
  qi: number;
  spiritStone: number;
  spiritHerb: number;
  pills: number;
  cultivation: number;
  totalTokens: number;
  lastFedAt: string | null;
}
```

Add server helpers:

```ts
export function practiceOnce(ledger: Ledger): boolean;
export function farmOnce(ledger: Ledger): boolean;
export function meditateOnce(ledger: Ledger): boolean;
export function runAlchemy(ledger: Ledger): boolean;
```

Map TokenTracker sync to `qi` gains while preserving raw token totals for telemetry.

- [ ] **Step 4: Add HTTP routes for the four actions**

Update `apps/server/src/index.ts` to expose:

```ts
POST /api/actions/practice
POST /api/actions/farm
POST /api/actions/meditate
POST /api/actions/alchemy
```

Each route should return the same `GameStateResponse` shape as `/api/state`.

- [ ] **Step 5: Re-run tests**

Run:

```bash
corepack pnpm test
```

Expected: server tests pass and `GET /` regression still returns 200.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/store.ts apps/server/src/index.ts apps/server/src/index.test.ts apps/server/src/cultivation.test.ts
git commit -m "feat: add cultivation game state"
```

---

## Task 3: Rebuild the Game Window UI

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/styles.css`
- Create: `apps/web/src/components/TianjiOverlay.tsx`
- Create: `apps/web/src/components/CultivationTabs.tsx`
- Create: `apps/web/src/components/ResourceRail.tsx`
- Create: `apps/web/src/components/ActivityLog.tsx`

- [ ] **Step 1: Write the failing UI test**

Add a focused render test for the shell and tab labels using the project’s current test stack, for example:

```tsx
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderCultivationShell } from './App';

test('renders cultivation tabs and Tianji loading label', () => {
  const view = renderCultivationShell();
  assert.match(view, /修炼/);
  assert.match(view, /种田/);
  assert.match(view, /打坐/);
  assert.match(view, /炼丹/);
  assert.match(view, /正在读取天机/);
});
```

- [ ] **Step 2: Run it and verify it fails**

Run:

```bash
corepack pnpm test
```

Expected: no cultivation shell renderer exists yet.

- [ ] **Step 3: Implement the shell**

Build `apps/web/src/App.tsx` around one persistent shell with:

```tsx
<main className="cultivation-shell">
  <header />
  <aside />
  <section className="stage">
    <CultivationTabs />
    <ActivityPanel />
  </section>
  <aside />
  <footer />
</main>
```

Use the tabs to switch between the four pages and keep the status rails visible across pages.

- [ ] **Step 4: Style the new layout**

Update `apps/web/src/styles.css` with:

```css
body {
  background: #0b1514;
  color: #f4efe3;
}

.cultivation-shell {
  display: grid;
  grid-template-columns: 280px minmax(0, 1fr) 280px;
  grid-template-rows: auto 1fr auto;
}
```

Keep the interface dense but breathable, with no horizontal scroll at the current desktop minimum width.

- [ ] **Step 5: Re-run tests and build**

Run:

```bash
corepack pnpm test:desktop
corepack pnpm build
```

Expected: desktop tests remain green; web build succeeds.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/styles.css apps/web/src/components
git commit -m "feat: rebuild game window as cultivation ui"
```

---

## Task 4: Add Tianji Loading and Page Transitions

**Files:**
- Create or modify: `apps/web/src/components/TianjiOverlay.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/styles.css`

- [ ] **Step 1: Write the failing test**

Write one interaction test that verifies the overlay shows on initial load and during action fetches:

```tsx
import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldShowTianjiOverlay } from './App';

test('shows Tianji overlay while loading', () => {
  assert.equal(shouldShowTianjiOverlay({ isLoading: true, isTransitioning: false }), true);
  assert.equal(shouldShowTianjiOverlay({ isLoading: false, isTransitioning: true }), true);
  assert.equal(shouldShowTianjiOverlay({ isLoading: false, isTransitioning: false }), false);
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run:

```bash
corepack pnpm test:desktop
```

Expected: overlay helper not implemented yet.

- [ ] **Step 3: Implement the overlay**

Use a centered loading layer with:

```tsx
<div className="tianji-overlay">
  <div className="tianji-ring" />
  <p>正在读取天机……</p>
</div>
```

Reuse it for page transitions and for any sync or mutation that takes longer than a brief instant.

- [ ] **Step 4: Re-run the UI tests**

Run:

```bash
corepack pnpm test:desktop
```

Expected: overlay and shell tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/App.tsx apps/web/src/styles.css apps/web/src/components/TianjiOverlay.tsx
git commit -m "feat: add tianji loading overlay"
```

---

## Task 5: Update Player Docs and Verify the Slice

**Files:**
- Modify: `README.md`
- Modify: `docs/player-guide.md`
- Modify: `docs/api.md`
- Modify: `docs/development.md`

- [ ] **Step 1: Add a doc regression checklist**

Before touching docs, verify the current player guide still explains:

```text
macOS download -> TokenGame-darwin-arm64.zip -> Token Game.app
Windows download -> TokenGame-win32-x64.zip -> TokenGame.exe
```

and that it now mentions the cultivation pages and Tianji loading language.

- [ ] **Step 2: Update the player-facing wording**

Replace cat-food wording in the game explanation with:

```text
修炼 / 种田 / 打坐 / 炼丹
```

and keep TokenTracker as the backend source of `天机入账`.

- [ ] **Step 3: Run the full verification set**

Run:

```bash
corepack pnpm test
corepack pnpm test:desktop
corepack pnpm test:scripts
corepack pnpm typecheck
corepack pnpm build
```

Expected: all commands pass.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/player-guide.md docs/api.md docs/development.md
git commit -m "docs: describe cultivation ui and player flow"
```

## Self-Review

- The spec covers the new cultivation vocabulary, four pages, and the Tianji loading overlay.
- Each implementation task has concrete files, tests, and commands.
- No placeholder text remains.
- The UI plan and server plan use the same resource names and page names.
- The plan stays scoped to one slice: redesign the game window and its backing state, not the desktop launcher.

