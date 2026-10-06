---
id: bundling
title: Bundling for Production
---

Temporal workers run workflows from a **bundle**: your workflow code compiled by webpack into one script that runs in the v8 sandbox. By default the SDK builds that bundle every time the worker starts, which is slow and depends on your TypeScript sources being on disk. This page covers how to get fast, predictable bundling from `nest build`, Docker and CI.

## Pick one

| Option | Bundling happens | Use when |
| --- | --- | --- |
| `workflowsPath` (default) | At every worker start, by the SDK | Development, small apps |
| `workflowsPath` + `autoBundle` | At startup, **cached by content hash** | Most production apps: no build step to wire up |
| `workflowBundle: { codePath }` | Ahead of time, in your build | Docker/CI pipelines that already build artifacts |

These are mutually exclusive: `autoBundle` cannot be combined with `workflowBundle`, and it requires `workflowsPath`.

## Point at your workflows

```typescript
import * as path from 'path';

TemporalModule.register({
  connection: { address: process.env.TEMPORAL_ADDRESS! },
  taskQueue: 'orders',
  worker: {
    workflowsPath: path.join(__dirname, 'workflows'),
    autoBundle: true,
    activityClasses: [OrderActivities],
  },
});
```

`workflowsPath` is checked at startup:

- Relative paths resolve against `process.cwd()`.
- A path without an extension is tried as `.ts`, `.js`, `.mjs`, `.cjs`, then as a directory with an `index` file.
- **`.ts` and `.js` are swapped** when only the other exists. `src/workflows.ts` still works from `dist/`, and `dist/workflows.js` still works under ts-node. Build with `nest build`, run from `dist/`, and the same line works.
- A missing path fails with the paths that were tried. With `autoBundle` this is a startup error. Without it, it is logged as a warning and the SDK reports its own error, so existing apps behave as before.
- Numeric ids are rejected. If you bundle your **server** with webpack or esbuild, `require.resolve()` turns into a number such as `1234`. Pass a real path, or use a prebuilt bundle (below).

## `autoBundle`

```typescript
worker: {
  workflowsPath: path.join(__dirname, 'workflows'),
  autoBundle: {
    cacheDir: '/var/cache/app-workflows', // default: <os tmpdir>/nestjs-temporal-core-bundles
    hashPaths: [path.join(__dirname, '../shared')], // code the workflows import from outside their folder
    bundlerOptions: { ignoreModules: ['crypto'] },   // passed to the SDK's bundleWorkflowCode
  },
}
```

- The first start builds the bundle and writes `<cacheDir>/<hash>.js`. Later starts with unchanged source load it and skip webpack.
- The hash covers every file under the directory of `workflowsPath`, any `hashPaths`, the SDK version and `bundlerOptions` (function options are hashed by their source). Editing a workflow changes the hash and rebuilds.
- **The hash cannot see imports from outside the workflow folder.** If workflows import shared code from elsewhere, add that directory to `hashPaths`, or the cache will serve a stale bundle.
- `cache: false` bundles on every start.
- A torn or empty cache file is treated as a miss and rebuilt.
- Startup logs `Workflow bundle built` or `loaded from cache`, with the first 12 characters of the hash.

In containers, set `cacheDir` to a writable path. A read-only filesystem needs a prebuilt bundle.

## Prebuilt bundle with `codePath`

Build the bundle in CI and ship the file:

```typescript
// scripts/bundle-workflows.ts
import { bundleWorkflowCode } from '@temporalio/worker';
import { writeFile } from 'fs/promises';

const { code } = await bundleWorkflowCode({ workflowsPath: require.resolve('../src/workflows') });
await writeFile('dist/workflow-bundle.js', code);
```

```typescript
worker: {
  workflowBundle: { codePath: path.join(__dirname, 'workflow-bundle.js') },
}
```

Prebuilt bundles are not touched by this library, so add any workflow interceptor modules (for example `nestjs-temporal-core/dist/observability/workflow-interceptors` for correlation ids) when you build.

## Recipes

### `nest build` and `node dist/main.js`

Use `path.join(__dirname, 'workflows')` with `autoBundle: true`. `__dirname` is `dist/` at runtime and the `.js` file is found.

### Docker

Either set `cacheDir` to a volume or tmpfs path and accept one cold start per container, or bundle in the image build and use `codePath` for zero bundling at runtime. The second is faster to boot and avoids shipping workflow sources.

### Nx / monorepos

Workflows often import shared libraries. Put those directories in `hashPaths`, or use a prebuilt `codePath` bundle built by an Nx target that depends on the library builds.

### Webpack/esbuild-bundled servers

The workflow source files must exist on disk at runtime. Copy them next to the output (or use a prebuilt bundle) and pass an explicit path, never `require.resolve()`.
