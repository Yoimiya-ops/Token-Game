# Secondary Building Panels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second-level right-side drawer for every cultivation menu/building.

**Architecture:** Keep backend APIs unchanged. Add a small pure helper module for panel metadata and wire React state so clicking each map building opens a right-side drawer with building-specific resources, explanation, primary action, and contextual logs.

**Tech Stack:** React, TypeScript, CSS, Vite, Node test runner with `tsx`.

---

### Task 1: Panel Metadata

**Files:**
- Create: `apps/web/src/building-panel.ts`
- Create: `apps/web/src/building-panel.test.ts`
- Modify: `apps/web/package.json`

- [x] Add pure metadata helpers for panel title, primary action, metrics, and empty/archive behavior.
- [x] Add node tests proving every building has panel data and archive has no primary action.
- [x] Run `npm run test --workspace @token-game/web` and expect the tests to pass.

### Task 2: React Drawer

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/styles.css`

- [x] Import the panel helpers and add `openPanelBuilding` state.
- [x] Change map building clicks to open the drawer while preserving active-building highlighting.
- [x] Render a dismissible right-side drawer with title, description, metrics, primary action, and related logs/items.
- [x] On narrow screens, make the drawer behave as a bottom sheet.

### Task 3: Verification

**Files:**
- Verify generated app and package outputs.

- [x] Run `npm run test --workspace @token-game/web`.
- [x] Run `npm run typecheck --workspaces --if-present`.
- [x] Run `npm test --workspaces --if-present`.
- [x] Run `npm run dist:current`.
- [x] Run `npm run dist:win`.
- [x] Open the app locally and verify clicking each building opens the drawer.
