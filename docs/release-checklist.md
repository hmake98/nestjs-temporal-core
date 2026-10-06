# Release checklist

Releases are cut by the `Release` workflow (`.github/workflows/release.yml`, manual `workflow_dispatch`). It bumps the version, tags, tests, builds, publishes to npm with provenance, creates the GitHub release and deploys the docs site. Use this list to prepare and verify.

## Before

1. `main` is green on CI (lint, test on Node 20/22/24, build, audit, integration).
2. Every merged PR since the last tag is reflected in `CHANGELOG.md`. Add a `## [x.y.z] - YYYY-MM-DD` section at the top (newest first), one line per user-visible change with the short commit hash.
3. Choose the bump. Rule for 3.x: no breaking changes, so `patch` (fixes, docs) or `minor` (additive features). Anything breaking waits for v4.
4. `npm run release:dry` locally and check the `files` list in the output (`dist/**/*`, `LICENSE`, `README.md`, `CHANGELOG.md`, `llms.txt`, plus any new subpath stubs).
5. `peerDependencies` ranges unchanged unless the release is deliberately widening or narrowing compatibility.

## Run

1. Merge the changelog PR to `main`.
2. GitHub, Actions, `Release`, `Run workflow`, pick the bump type.
3. The workflow runs `npm version` (creates `chore: release vX.Y.Z` and the `vX.Y.Z` tag, pushes to `main`), tests, builds, publishes, creates the GitHub release, and deploys docs.

## After

1. `npm view nestjs-temporal-core version` shows the new version, and the package page shows the provenance badge.
2. GitHub release `vX.Y.Z` exists; docs site at https://hmake98.github.io/nestjs-temporal-core/ updated.
3. Smoke test: `npm pack nestjs-temporal-core@X.Y.Z`, install in a scratch Nest app, boot it.
4. Record weekly npm downloads and GitHub stars in `docs/metrics.md`.

## If it fails halfway

- Publish failed after the tag was pushed: fix the cause, delete the tag (`git push --delete origin vX.Y.Z`), revert the version commit on `main`, and re-run the workflow. Provenance only works from CI, so do not publish by hand.
- Bad version already on npm: never unpublish. Publish a fixed patch and run `npm deprecate nestjs-temporal-core@X.Y.Z "reason"`.
