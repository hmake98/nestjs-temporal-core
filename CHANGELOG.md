# Changelog

## [Unreleased]

### Changes

- feat: `nestjs-temporal-core/encryption` entry: AES-256-GCM payload codec (`createEncryptionDataConverter`, `createStaticKeyProvider`, `AesGcmPayloadCodec`) with key ids for rotation, authenticated key id, plaintext pass-through for existing namespaces.
- feat: module-level `dataConverter` option applied to both client and worker (specific `connection.dataConverter` / `workerOptions.dataConverter` still win).
- feat: connection security checks: warn on plaintext connections to remote servers (with or without credentials); `strictSecurity: true` makes them startup errors.
- feat: `TemporalHealthModule.register({ detail: 'minimal' })` and `nestjs-temporal-core/terminus` health indicator (`@nestjs/terminus` is an optional peer).
- docs: "Security" page.
- feat: `runtime` option installs the SDK `Runtime` once and early (idempotent, warns on late install) and can route SDK/Core logs to the Nest logger.
- feat: `redact()` and `redactKeys`: credentials, TLS material and payload bodies are redacted in library logs.
- feat: `correlation` option: correlation id propagated client -> workflow -> activity via `AsyncLocalStorage`; `runWithCorrelationId` / `getCorrelationId`; library logs are tagged with it.
- feat: `nestjs-temporal-core/otel` entry: `createTemporalOpenTelemetry` and `prometheusTelemetry`. OpenTelemetry packages are optional peers.
- docs: "Production Observability" page.
- feat: `nestjs-temporal-core/testing` entry: `TemporalTestingModule` (fake `TemporalService` / `TemporalClientService` with call recording, configurable results and errors), `createActivityHarness` and `overrideActivity`. `@nestjs/testing` and `@temporalio/testing` are optional peer dependencies.
- test: integration suites for signal, query, update, signalWithStart, cancel/terminate, schedule lifecycle and shutdown drain; consumer smoke test (`npm run test:smoke`) wired into CI.
- docs: "Testing Your Temporal Code" page; worker-only guide now documents `shutdownGraceTime`.
- feat: `TemporalClientError` (exported) keeps the original SDK error as `cause`, with `originalName`, `grpcCode` and `grpcDetails`; applied to the client, facade and schedule services. Message text is unchanged.
- feat: `TemporalService.upsertSchedule`, `updateSchedule` and `deleteSchedule` delegate to the schedule service.
- docs: worker-only app guide and error-handling page.

## [3.4.0] - 2026-07-11

### Changes

- fix: align `WorkflowStartOptions` and client options with Temporal SDK-native types (cb9804a)
- feat(schedule): add `upsertSchedule` for create-or-update (a2d4864)
- ci: update npm installation step and remove `NPM_TOKEN` verification (1514bd2)
- build(release): use Node.js 22 in the release workflow (601cdfc)
- docs: add NestJS and Temporal SDK convention docs, Claude Code agent and skill setup (afab95e, 95ad3eb)

## [3.3.0] - 2026-07-08

### Changes

- fix: update `@temporalio/*` dev dependencies to 1.19.1 (a417291)

## [3.2.10] - 2026-07-07

Note: `v3.2.9` was never tagged; its changes are included here.

### Changes

- feat: add schedule management methods (update, delete and related) to `TemporalScheduleService` (6f6e671)
- fix: fetch and rebase before the version bump in the release workflow (cc9d799)

## [3.2.8] - 2026-04-30

### Changes

- feat: add `muteErrors` option to suppress error logging (e4ba4b4)
- fix: keep throw behavior, mute only `logger.error()` in catch blocks (b6ff16d)

## [3.2.7] - 2026-04-19

### Changes

- feat(workflow-proxy): add typed workflow proxy and related utilities (c2cf97a)
- feat: normalize schedule options in `TemporalScheduleService` (aeb3b2e)
- ci: report Jest results as JUnit to Codecov, update Codecov actions to v5 (a649674, dd72a97, 115e817, c0496c5)
- docs: add TypeScript doc examples to interfaces and services (5644981)

## [3.2.6] - 2026-03-26

### Changes

- Version bump only.

## [3.2.5] - 2026-03-26

### Changes

- chore: update dependencies and improve test coverage (35b537f)

## [3.2.4] - 2026-03-26

### Changes

- fix: re-throw `WorkflowExecutionAlreadyStartedError` without wrapping in `TemporalClientService`, so callers can still match the SDK type (4e1049b)

## [3.2.3] - 2026-01-22

### Changes

- feat: support the missing schedule options (`paused`, `overlapPolicy`, and others) (252316e)

## [3.2.2] - 2026-01-19

### Changes

- feat: add `workflowExecutionTimeout`, `workflowRunTimeout` and `workflowTaskTimeout` to `startWorkflow` and `createSchedule`; options use the SDK `Duration` type (78d919d)
- fix: drop the unused `searchAttributes` option in favor of `typedSearchAttributes` (78d919d)

## [3.2.1] - 2026-01-12

### Changes

- feat: add configurable `autoRestart` and `maxRestarts` worker options (f1ef145)
- fix: resolve worker auto-restart failure and improve the health check (aab3f95)
- refactor: improve error handling and logging verbosity across services (162bea4, 13f80f5)

## [3.2.0] - 2025-11-28

### Changes

- fix: filter activities by `activityClasses` in `TemporalWorkerManagerService` (a4e2972)
- feat: enhance workflow ID validation in `TemporalClientService` (8290a44)
- ci: add CI workflow (lint, test, build) and docs deployment (7d55e2d, 9582027)
- chore: add `format:check`, `lint:check` and `test:integration` scripts (2217c3f, bac5c25)

## [3.1.7] - 2025-11-12

### Changes

- Update documentation for constants in nestjs-temporal-core (dc2d392)

## [3.1.6] - 2025-11-12

### Changes

- chore: update release workflow to generate documentation after version bump; improve README with example project details (15cd112)

## [3.1.5] - 2025-11-12

### Changes

- Update documentation for TIMEOUTS and WORKFLOW_PARAMS_METADATA; remove WorkflowRun documentation (c293dc5)

## [3.1.4] - 2025-11-12

### Changes

- chore: add environment configuration for GitHub Pages deployment (2236d03)

## [3.1.3] - 2025-11-12

### Changes

- test: remove redundant tests for registerScheduledWorkflow error handling (e83e15e)
- chore: update release workflow to generate and deploy documentation to GitHub Pages test: enhance error handling in TemporalScheduleService for ScheduleClient initialization (4fb1ed0)
- test: improve error handling in worker shutdown process (234c751)
- test: enhance coverage for worker creation and shutdown error handling (75b2ffb)
- test: enhance error handling and lifecycle hook coverage in TemporalWorkerManagerService (b89d8e0)
- chore: remove pull request trigger from CI/CD pipeline and standardize cache syntax (8a82aff)
- feat: add shutdown hooks and timeout options for graceful worker termination (a369697)
- chore: remove outdated CHANGELOG.md file (745e94a)
- refactor: streamline error handling and logging in worker shutdown process (c7838c0)
- feat: enhance worker management and cleanup logic (f91e4ee)

