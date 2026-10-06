---
id: intro
title: Introduction
---

# NestJS Temporal Core

A comprehensive NestJS integration framework for [Temporal.io](https://temporal.io/) that provides enterprise-ready workflow orchestration with automatic discovery, declarative decorators, and robust monitoring capabilities.

NestJS Temporal Core bridges NestJS's dependency injection system with Temporal.io's workflow orchestration engine, giving you a declarative approach to building distributed, fault-tolerant applications with automatic service discovery, enterprise-grade monitoring, and seamless integration.

## Why NestJS Temporal Core?

| Feature | Description |
|---------|-------------|
| **Seamless Integration** | Native NestJS decorators and dependency injection support |
| **Auto-Discovery** | Automatic registration of activities via decorators |
| **Type Safety** | Full TypeScript support with comprehensive type definitions |
| **Enterprise Ready** | Built-in health checks, monitoring, and error handling |
| **Zero Configuration** | Smart defaults with extensive customization options |
| **Modular Architecture** | Use client-only, worker-only, or full-stack configurations |
| **Production Grade** | Connection pooling, graceful shutdown, and fault tolerance |

## Features

### Core Capabilities

- **Declarative Decorators** — Use `@Activity()` and `@ActivityMethod()` for clean, intuitive activity definitions
- **Automatic Discovery** — Runtime discovery and registration of activities with zero configuration
- **Schedule Management** — Programmatic schedule creation, updates, and monitoring
- **Health Monitoring** — Built-in health checks and comprehensive status reporting
- **Typed Workflow Proxy** — Generic `IWorkflowProxy<T>` that infers start args, signal args, and query return types from your workflow function signature
- **Signal-with-Start** — Atomic "ensure running + signal" on both the low-level client service and the high-level `TemporalService`

### Enterprise Features

- **Connection Management** — Automatic connection pooling and lifecycle management
- **Error Handling** — Structured error handling with detailed logging and retry policies
- **Performance Monitoring** — Built-in metrics, statistics, and performance tracking
- **Graceful Shutdown** — Clean resource cleanup and connection termination

### Flexibility & Scalability

- **Modular Design** — Use only what you need (client-only, worker-only, or combined)
- **Multiple Workers** — Support for multiple workers with different task queues
- **Advanced Configuration** — Extensive customization for production environments
- **TLS Support** — Secure connections for Temporal Cloud deployments

## Requirements

- **Node.js**: >= 20.3.0 (required by `@temporalio/*` 1.19; Node 16 and 18 are not supported)
- **NestJS**: 9, 10, 11 or 12
  - NestJS 12 is ESM-only. This package ships CommonJS, so on NestJS 12 you need Node 20.19+ or 22.12+, where `require()` can load ES modules.
  - The optional `nestjs-temporal-core/terminus` entry needs `@nestjs/terminus` 11 or 12.
- **`@temporalio/*`**: `^1.15.0 || ^1.19.0`
- **Temporal Server**: a reachable server or Temporal Cloud namespace. Tested against Temporal Server 1.29 (Docker) and the Temporal CLI dev server 1.32.

Continue to [Getting Started](./getting-started.md).
