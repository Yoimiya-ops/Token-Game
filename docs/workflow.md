# Development Workflow

## Workflow Goal

Create a development loop that keeps implementation fast while preserving determinism around token ingestion,
economy math, and progression state.

## Working Model

Use a documentation-first and vertical-slice-first workflow.
The project should always keep one playable path working end to end:
mock token input -> normalized event -> resource gain -> upgrade purchase -> persisted state -> offline resume.

## Branching Strategy

- `main`: always releasable or at least runnable
- short-lived feature branches for substantial work
- merge in small slices that preserve a working game loop

Recommended branch prefixes:

- `feat/`
- `fix/`
- `docs/`
- `refactor/`
- `test/`

## Task Breakdown Rule

Every feature should be split across these layers when relevant:

1. domain rule
2. persistence model
3. API contract
4. UI surface
5. test coverage

This prevents UI-first development from hiding broken progression logic.

## Daily Development Loop

1. Pick one vertical slice with a visible gameplay outcome.
2. Write or update the domain rule first.
3. Add or update the shared schema.
4. Implement server persistence/API changes.
5. Implement the client UI.
6. Add tests for the slice.
7. Manually verify the full flow.
8. Record any balancing observations in docs or config comments.

## Definition Of Done

A task is done only when:

- the feature works from the authoritative data path
- the relevant domain logic has automated tests
- edge cases are handled or explicitly documented
- the UI reflects loading, empty, and error states where relevant
- any schema/config changes are documented

## Local Workflow Setup

### Initial Tooling

Install and standardize on:

- Node.js 22 LTS
- pnpm 10+
- Git
- Playwright browsers

### Planned Commands

Keep these scripts available early:

- `pnpm dev`: run web and server together
- `pnpm test`: run all unit/integration tests
- `pnpm test:e2e`: run Playwright tests
- `pnpm lint`: run ESLint
- `pnpm typecheck`: run TypeScript checks
- `pnpm db:migrate`: apply Prisma migrations
- `pnpm db:studio`: inspect local data

## Recommended Delivery Order

### Stage 1: Foundation

- scaffold monorepo
- configure TypeScript, ESLint, Prettier
- configure shared package boundaries
- add Prisma and first schema
- add seed/mock generator

### Stage 2: Deterministic Core

- token event normalization
- ledger generation
- resource formulas
- offline progression calculation
- snapshot rebuild command

### Stage 3: First Playable UI

- dashboard shell
- primary resource counter
- token ingestion log
- first building/upgrade list
- save/sync state banner

### Stage 4: Reliability

- duplicate event protection
- migration handling
- error reporting
- regression tests around progression math

## Engineering Conventions

### Domain Logic

- Put progression math in pure functions under shared/domain modules.
- Avoid mixing economy formulas into route handlers or React components.
- Prefer append-only ledgers for auditability.

### Config

- Keep upgrade definitions and tuning values in structured config files.
- Version balance data so changes can be traced when saves behave differently.

### APIs

- Validate all inbound payloads with Zod.
- Use explicit DTOs rather than exposing raw ORM models.

### Database

- Favor additive migrations.
- Keep seed data small and deterministic.
- Create at least one rebuild path from raw token events to derived state.

## Testing Workflow

### Before Merging

Run at minimum:

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`

Run `pnpm test:e2e` for:

- onboarding changes
- progression changes
- persistence changes
- token ingestion changes

### Priority Test Matrix

The most failure-prone systems are:

- duplicate token ingestion
- time-based progression
- cost scaling and rounding
- save recovery after schema changes
- adapter mapping differences between providers

## Documentation Workflow

Update docs when any of these change:

- data model
- token event schema
- progression formulas
- environment setup
- build/test commands

Minimum documentation set to maintain:

- `README.md`: project entry and current setup
- `docs/tech-stack.md`: architectural decisions
- `docs/workflow.md`: team execution rules
- future `docs/game-design.md`: economy and feature design
- future `docs/adr/`: architecture decision records when major choices change

## Productivity Workflow For This Project

To improve implementation speed in later steps, maintain these habits:

- build shared schemas before feature-specific endpoints
- keep one mock token source available at all times
- prefer config-driven balancing over code edits
- add debug panels early for token events, derived resource deltas, and offline calculations
- keep deterministic fixture data for regression testing

## Immediate Next Actions

After these documents, the next efficient implementation sequence is:

1. scaffold pnpm workspace and base apps
2. define `TokenEvent` schema in `packages/shared`
3. create Prisma schema for token ledger and player state
4. implement mock token generator and ingestion endpoint
5. render a minimal dashboard showing token-derived resources

This order minimizes rework and gives a fast playable slice.
