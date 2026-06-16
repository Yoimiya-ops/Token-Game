# Technical Stack

## Product Goal

Build an idle game whose primary resource is generated from tracked LLM token consumption.
A token tracker ingests usage from supported model providers or local usage logs, converts it into game resources,
and drives both active and offline progression.

## Core Product Assumptions

- The game must run as a local-first web application.
- Token usage is the canonical input signal for progression.
- The first release should support manual import and local mock data before any live provider integration.
- Offline progression must be deterministic and replayable from recorded token events.
- The economy model must remain inspectable so balancing can be iterated quickly.

## Technical Choice Summary

- Frontend: React 19 + TypeScript + Vite
- UI Styling: Tailwind CSS + CSS variables for theme tokens
- State Management: Zustand
- Server/API Layer: Node.js 22 + Fastify + TypeScript
- Database: SQLite with Prisma ORM for local-first development
- Background Jobs: Server-side scheduler using node-cron, with all authoritative progression calculations persisted in the database
- Shared Validation: Zod for DTO and event schema validation
- Testing: Vitest for unit/integration, Playwright for end-to-end gameplay tests
- Tooling: pnpm + Turborepo-style monorepo structure (can start as a lightweight workspace before full scaling)
- Deployment Target: Local desktop/browser first, optional later deployment to a small VPS or serverless API

## Why This Stack

### React + TypeScript + Vite

This game needs fast UI iteration, reusable panel-based screens, and responsive data updates for resources,
upgrades, logs, and economy visualizations. React with Vite gives short feedback loops and a mature ecosystem.
TypeScript is necessary because the game will center around event schemas, derived stats, and progression rules that are easy to break with weak typing.

### Tailwind CSS + CSS Variables

The project needs a fast way to build a clear game HUD, dashboard panels, and progression views without spending early effort on a custom CSS architecture.
CSS variables keep theme and rarity/resource colors centralized, which matters once the game starts exposing many token/resource categories.

### Zustand

The game will likely have a moderate amount of client state: player view state, selected tabs, local simulation previews,
and transient sync status. Zustand is simpler than Redux and sufficient for this scale.
Authoritative progression should still come from the server/database, not from client memory.

### Node.js + Fastify

The backend needs to ingest token events, expose progression APIs, and run recurring resource updates.
Fastify is lightweight, typed, and operationally simpler than a heavier framework.
It is a good fit when the main complexity is domain logic rather than framework conventions.

### SQLite + Prisma

The project starts as a solo-built prototype and should stay frictionless to run locally.
SQLite keeps setup trivial, while Prisma makes schema iteration and typed data access fast.
If the project later needs multi-user deployment, PostgreSQL can replace SQLite with limited domain-layer changes.

## Recommended Monorepo Layout

```text
Token-Game/
  apps/
    web/            # React game client
    server/         # Fastify API and scheduler
  packages/
    shared/         # Shared schemas, constants, helpers
    config/         # tsconfig/eslint/prettier presets
  docs/
    tech-stack.md
    workflow.md
  prisma/
    schema.prisma
  scripts/
  package.json
  pnpm-workspace.yaml
```

## Domain Model Direction

### Core Entities

- `token_event`: raw tracked token usage event
- `resource_ledger`: normalized resource delta records derived from token events
- `player_state`: current resources, buildings, unlocks, milestones
- `upgrade_definition`: economy config for upgrades/buildings
- `upgrade_purchase`: player purchase history
- `simulation_snapshot`: periodic derived state for recovery and offline progression

### Key Rule

Raw token events are append-only.
All resource generation should be reproducible from token events plus economy rules,
which makes debugging, rebalance work, and anti-cheat checks substantially easier.

## Token Tracker Integration Strategy

### Phase 1

- Manual import of token usage JSON/CSV
- Local mock event generator for development
- Simple adapter interface for future providers

### Phase 2

- OpenAI usage ingestion adapter
- Local file watcher or polling-based sync
- Token category mapping: input tokens, output tokens, cached tokens, reasoning tokens if exposed

### Adapter Contract

Each tracker adapter should output a normalized event such as:

```ts
export type TokenEvent = {
  id: string;
  source: 'mock' | 'manual-import' | 'openai';
  model: string;
  kind: 'input' | 'output' | 'cached' | 'reasoning';
  tokenCount: number;
  occurredAt: string;
  metadata?: Record<string, string | number | boolean>;
};
```

## Gameplay Architecture Constraints

- Resource generation formulas live in shared pure functions.
- Server computes authoritative progression.
- Client may run preview simulations but never becomes the source of truth.
- Offline gains are calculated from the last processed timestamp and event ledger, not from browser uptime.
- Game balance data should live in versioned config objects or JSON files, not hardcoded inside UI components.

## Testing Strategy

### Unit Tests

Focus on:

- token normalization
- resource conversion formulas
- upgrade cost scaling
- offline progression calculations
- save/load reconciliation

### Integration Tests

Focus on:

- event ingestion to ledger persistence
- purchase flow against authoritative state
- duplicate token event handling
- snapshot rebuild consistency

### E2E Tests

Focus on:

- first-time onboarding with mock token feed
- upgrade purchase loop
- offline return reward presentation
- manual import success/failure paths

## Non-Goals For First Milestone

- real-time multiplayer
- blockchain/NFT mechanics
- complex anti-cheat infrastructure
- mobile app packaging
- highly customized rendering engines such as Phaser or Unity

## Milestone Recommendation

### M0: Foundation

- initialize monorepo
- create shared schema package
- create web and server apps
- define first database schema
- implement mock token event generator

### M1: Vertical Slice

- ingest mock token events
- convert tokens into one primary resource
- show HUD, resource counters, and one upgrade tree
- persist save data locally
- support offline progression

### M2: Real Tracker

- add first real provider adapter
- surface sync history and ingestion errors
- add balancing telemetry panels

## Decision Record

This stack prioritizes:

- local setup speed
- deterministic game logic
- easy balancing iteration
- strong typing across event-driven systems
- gradual evolution from prototype to a deployable service

It intentionally avoids premature engine complexity.
The hard part of this game is not graphics; it is reliable token ingestion, progression math, and debugability.
