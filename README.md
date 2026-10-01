# NestJS Temporal Core

<div align="center">

Enterprise-ready [Temporal.io](https://temporal.io/) workflow orchestration for NestJS — auto-discovery, declarative decorators, typed workflow proxies, and built-in monitoring.

![Statements](https://img.shields.io/badge/statements-99.58%25-brightgreen.svg?style=flat)
![Branches](https://img.shields.io/badge/branches-93.4%25-brightgreen.svg?style=flat)
![Functions](https://img.shields.io/badge/functions-97.37%25-brightgreen.svg?style=flat)
![Lines](https://img.shields.io/badge/lines-99.69%25-brightgreen.svg?style=flat)
[![codecov](https://codecov.io/gh/hmake98/nestjs-temporal-core/branch/main/graph/badge.svg?token=BYSE45L6DI)](https://codecov.io/gh/hmake98/nestjs-temporal-core)

[**📖 Full Documentation**](https://hmake98.github.io/nestjs-temporal-core/) • [NPM](https://www.npmjs.com/package/nestjs-temporal-core) • [GitHub](https://github.com/hmake98/nestjs-temporal-core) • [Example Project](https://github.com/hmake98/nestjs-temporal-core-example)

</div>

---

## Core Features

| Feature | What it gives you |
|---------|-------------|
| 🔌 **Seamless NestJS Integration** | Native decorators + dependency injection — no boilerplate glue code |
| 🔍 **Auto-Discovery** | `@Activity()`/`@ActivityMethod()` classes are found and registered automatically |
| 🛡️ **Type Safety** | Typed workflow proxy (`IWorkflowProxy<T>`) — start/signal/query args and return types inferred from your workflow function |
| ❤️ **Health Monitoring** | Built-in `/health` endpoint plus programmatic `getHealth()`/`getStatistics()` |
| 🧩 **Modular Architecture** | Use client-only, worker-only, activity-only, schedules-only, or the full stack |
| 🏭 **Production Grade** | Connection pooling, multi-worker support, graceful shutdown, TLS for Temporal Cloud |

## Installation

```bash
npm install nestjs-temporal-core @temporalio/client @temporalio/worker @temporalio/workflow @temporalio/common
npm install @nestjs/common @nestjs/core reflect-metadata rxjs   # peer dependencies
```

## Quick Start

```typescript
// app.module.ts
import { Module } from '@nestjs/common';
import { TemporalModule } from 'nestjs-temporal-core';
import { PaymentActivity } from './activities/payment.activity';

@Module({
  imports: [
    TemporalModule.register({
      connection: { address: 'localhost:7233', namespace: 'default' },
      taskQueue: 'my-task-queue',
      worker: {
        workflowsPath: require.resolve('./workflows'),
        activityClasses: [PaymentActivity],
        autoStart: true,
      },
    }),
  ],
  providers: [PaymentActivity],
})
export class AppModule {}
```

Inject `TemporalService` anywhere to start/signal/query workflows. Don't forget `app.enableShutdownHooks()` in `main.ts` for graceful cleanup.

👉 Activities, workflows, and full service examples: [Getting Started guide](https://hmake98.github.io/nestjs-temporal-core/docs/getting-started).

## Documentation

This README covers only the basics. The [**documentation site**](https://hmake98.github.io/nestjs-temporal-core/) has everything else — a landing page, guides, config reference, and a generated API reference (source in [`website/docs`](website/docs)):

| Guide | Covers |
|---|---|
| [Getting Started](https://hmake98.github.io/nestjs-temporal-core/docs/getting-started) | Installation, quick start, module variants |
| [Configuration](https://hmake98.github.io/nestjs-temporal-core/docs/configuration) | Basic/multi-worker/async/TLS setup, full options reference |
| [Core Concepts](https://hmake98.github.io/nestjs-temporal-core/docs/core-concepts) | Activities, workflows, signals/queries, updates, typed workflow proxy |
| [Advanced Configuration](https://hmake98.github.io/nestjs-temporal-core/docs/advanced-configuration) | Interceptors, gRPC compression, worker versioning, standalone activities, schedule lifecycle |
| [Advanced Usage](https://hmake98.github.io/nestjs-temporal-core/docs/advanced-usage) | Activity retry policies, workflow testing |
| [Best Practices](https://hmake98.github.io/nestjs-temporal-core/docs/best-practices) | Do's and don'ts for workflows, activities, config, error handling, testing |
| [Health Monitoring](https://hmake98.github.io/nestjs-temporal-core/docs/health-monitoring) | Built-in health module, custom health checks |
| [Troubleshooting](https://hmake98.github.io/nestjs-temporal-core/docs/troubleshooting) | Common issues, debug mode, getting help |
| [Migration Guide](https://hmake98.github.io/nestjs-temporal-core/docs/migration-guide) | Upgrading across versions and SDK bumps |
| [API Reference](https://hmake98.github.io/nestjs-temporal-core/docs/api) | Generated from source (TSDoc) |

## Requirements

Node.js >= 20.3.0 • NestJS 9–12 • Temporal Server >= 1.20.0
(on Node 16/18, pin `@temporalio/*` to `^1.15.0` and stay on this package's previous minor)

## Contributing & Support

Contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Questions or bugs: [GitHub Issues](https://github.com/hmake98/nestjs-temporal-core/issues) • [Discussions](https://github.com/hmake98/nestjs-temporal-core/discussions) • [Changelog](https://github.com/hmake98/nestjs-temporal-core/releases).

MIT © — see [LICENSE](LICENSE).

---

<div align="center">

**[⭐ Star us on GitHub](https://github.com/hmake98/nestjs-temporal-core)** if you find this project helpful!

</div>
