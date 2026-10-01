# nestjs-temporal-core

NestJS integration library for Temporal.io. Provides auto-discovery, declarative scheduling, worker management, and enterprise features for running Temporal workflows in NestJS apps. Published as the `nestjs-temporal-core` npm package — peer-dependency library, not an app.

## Architecture

```
src/
  temporal.module.ts          # Main DynamicModule (register / registerAsync)
  interfaces.ts               # All TypeScript interfaces (TemporalOptions, etc.)
  constants.ts                # DI tokens: TEMPORAL_CLIENT, TEMPORAL_CONNECTION, etc.
  decorators/
    activity.decorator.ts     # @Activity, @ActivityMethod
    workflow.decorator.ts     # @SignalMethod, @QueryMethod, @UpdateMethod, @ChildWorkflow
  services/
    temporal.service.ts             # Public facade — start/signal/query/cancel workflows
    temporal-client.service.ts      # Wraps @temporalio/client Client
    temporal-connection.factory.ts  # Connection pooling (client + worker connections)
    temporal-discovery.service.ts   # Auto-discovers @Activity classes via NestJS DiscoveryModule
    temporal-schedule.service.ts    # CRUD for Temporal schedules
    temporal-worker.service.ts      # Worker lifecycle (start/stop/graceful shutdown)
    temporal-metadata.service.ts    # Reads Reflect.metadata from decorators (TemporalMetadataAccessor)
  providers/
    temporal-connection.factory.ts  # NestJS provider wrapping connection factory
  health/
    temporal-health.controller.ts   # /health endpoint
    temporal-health.module.ts
  utils/
    logger.ts         # Singleton TemporalLoggerManager, createLogger()
    metadata.ts        # Helpers for reading @Activity/@ActivityMethod metadata
    validation.ts       # validateSignalName/validateQueryName/validateUpdateName
    workflow-token.ts   # Generates DI tokens for workflow proxies
  workflow-proxy/
    workflow-proxy.ts          # WorkflowProxy class
    workflow-proxy.factory.ts  # WorkflowProxyFactory — typed proxy creation
  types/
    reflect-metadata.d.ts      # Ambient Reflect.metadata typings
```

Each folder (`decorators/`, `utils/`, `workflow-proxy/`) and `src/` itself re-exports its public surface via `index.ts`. Tests live under `test/unit`; `test/integration` is referenced by `package.json` scripts but doesn't currently exist — check before assuming it's present.

## Key Patterns

- **Module registration**: `TemporalModule.register(options)` or `TemporalModule.registerAsync({useFactory, useClass, useExisting})` — both converge on the same internal provider wiring.
- **DI tokens** (`src/constants.ts`): `TEMPORAL_CLIENT`, `TEMPORAL_CONNECTION`, `TEMPORAL_MODULE_OPTIONS`, `WORKER_MODULE_OPTIONS`, `ACTIVITY_MODULE_OPTIONS`. Reuse via `@Inject(TOKEN)`; don't add a new string token for something an existing one covers.
- **Decorators store metadata via `Reflect.defineMetadata`** on both constructor and prototype — required for `DiscoveryModule` compatibility. Missing either write breaks auto-discovery silently.
- **Auto-discovery**: `TemporalDiscoveryService` scans the NestJS module graph for classes decorated with `@Activity`.
- **WorkflowProxy**: `WorkflowProxyFactory.createProxy<T>({workflowType, taskQueue})` returns a typed proxy over `client.workflow.start` — prefer this over hand-rolled calls.
- **Graceful shutdown**: worker shutdown hooks are registered on NestJS lifecycle; requires the consuming app to call `app.enableShutdownHooks()` in `main.ts`.
- **Timeouts/retries**: reuse `TIMEOUTS`/`RETRY_POLICIES` presets in `constants.ts` instead of inlining new literals.

## Important Constraints

- Workflows run in a v8 isolated sandbox — no DI, no imports from NestJS/application context, no non-deterministic calls (`Date.now()`, `Math.random()`, timers, I/O). Activities are the escape hatch and run in normal Node context with full DI.
- Signal/Query/Update decorators register Reflect metadata only; actual handler wiring happens at worker runtime.
- Connection factory creates separate connections for client vs worker (different lifecycle) — don't share one across both.
- `TemporalLoggerManager` is a singleton; call `getInstance()` then `configure()` to set log level.

## Library packaging (this is an npm package)

- `peerDependencies`: `@nestjs/{common,core}` `^9 || ^10 || ^11 || ^12` (NestJS 12 is ESM-only; Jest tests against it need Node 24.9+ and `--experimental-vm-modules`, so CI runs NestJS 11 on Node 20/22 and NestJS 12 on Node 24), `@temporalio/{client,common,worker,workflow}` `^1.15.0 || ^1.19.0`, `reflect-metadata`, `rxjs`. Widening either range is a deliberate compatibility decision — verify against the SDK/NestJS versions actually supported, don't bump casually.
- `devDependencies` pin the toolchain used to build/lint/test the package itself (not shipped) — keep `typescript` on a stable line compatible with `@typescript-eslint`'s peer range; don't blindly accept `npm-check-updates` bumps into a prerelease major (see the `typescript ^7.0.2` ERESOLVE incident on this repo).
- `files` whitelist controls what actually ships (`dist/**/*`, `LICENSE`, `README.md`, `CHANGELOG.md`, `docs/README.md`, `jsdoc.json`) — new shipped assets must be added here.
- Version/release flow: `npm version` runs `fix-all` (format+lint) then stages `src`; `postversion` pushes commits+tags; `release`/`release:dry` build then `npm publish`. `.github/workflows/release.yml` automates this on tag push — keep its package name/URLs in sync with `package.json` (`name`, `homepage`).

## Subagents (`.claude/agents/`)

- **decorator-metadata-auditor** — after touching `src/decorators/`, `temporal-metadata.service.ts`, or `temporal-discovery.service.ts`: verifies the dual constructor+prototype `Reflect.defineMetadata` write.
- **workflow-sandbox-reviewer** — after touching workflow code (`@temporalio/workflow` imports, `workflow.decorator.ts`, `workflow-proxy/`): catches v8-sandbox violations (DI, non-determinism) before runtime.
- **github-workflows-reviewer** — after touching `.github/workflows/*.yml`: security + correctness + consistency across `ci.yml`/`release.yml`/`deploy-docs.yml`.
- **temporal-sdk-researcher** — before implementing/changing anything touching `@temporalio/*` APIs: confirms current SDK signatures/behavior against live docs rather than memory. Uses the `temporal-docs` MCP server first, WebSearch/WebFetch for changelog/GitHub specifics it doesn't cover.

## Skills (`.claude/skills/`)

- **nestjs** — dynamic module/DI conventions, registration patterns, DiscoveryModule auto-discovery, lifecycle hooks, testing conventions.
- **temporal** — Temporal.io concept decision matrix (workflow vs activity vs signal/query/update/child-workflow), where each concept lives in this repo, timeout/retry preset conventions.

Both skills, and the `temporal-sdk-researcher`/`workflow-sandbox-reviewer` subagents, are the first stop before reaching for the general `temporal:temporal-developer` plugin skill or raw source grep.

## MCP servers

- **temporal-docs** (declared in this repo's `.mcp.json`, `search_temporal_knowledge_sources` tool) — authoritative Temporal SDK/docs lookup; prefer over WebSearch for Temporal API questions.
- **codebase-memory-mcp** — structural code queries (`search_graph`, `trace_path`, `get_code_snippet`, `query_graph`, `get_architecture`, `search_code`, `index_status`, `detect_changes`) come first for "where is X defined", call chains, dependencies, impact analysis, architecture. Grep/Glob/Read stay fine for text, configs, non-code files. Indexing is manual only — if not indexed, ask before running `index_repository`.
- `context7` / other MCP servers referenced elsewhere are personal/global tooling, not declared at project level — don't assume every contributor has them.

## Documentation site (`website/`)

- Standalone Docusaurus project (own `package.json`/`node_modules`, not an npm workspace of the root package). README stays a short landing page; hand-written guides live in `website/docs/*.md`, deployed via `.github/workflows/deploy-docs.yml` to GitHub Pages.
- API reference is generated at build time by `docusaurus-plugin-typedoc` (runs TypeDoc + `typedoc-plugin-markdown` against `src/index.ts` using the root `tsconfig.docs.json`) into `website/docs/api/` — gitignored, never hand-edit generated API pages.
- Root scripts proxy into the site: `npm run docs:install`, `docs:dev` (local preview), `docs:build`, `docs:serve`, `docs:clean`.
- Adding a new guide: create `website/docs/<name>.md` with an `id`/`title` frontmatter, then add its id to `website/sidebars.js`'s `guideSidebar` array in reading order.

## claude-mem

This project's memory (`~/.claude-mem`) is global, not project-scoped, and injects relevant context passively at session start and per prompt. For non-trivial tasks (multi-file changes, bug investigations, "did we solve this before" questions, or anything where past decisions matter), explicitly search it before drafting a solution rather than relying only on passive injection — use the `mcp__plugin_claude-mem_mcp-search__search` (or `smart_search`) tool. Skip this for trivial, single-file, no-context-needed edits — it's not worth the round trip.
