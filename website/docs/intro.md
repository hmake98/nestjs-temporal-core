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
| **Auto-Discovery** | Automatic registration of activities and workflows via decorators |
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

- **Node.js**: >= 20.3.0 (required by `@temporalio/*` 1.19; if you're on Node 16/18, stay on `nestjs-temporal-core@<version>` pinned to `@temporalio/*` `^1.15.0`)
- **NestJS**: >= 9.0.0
- **Temporal Server**: >= 1.20.0

Continue to [Getting Started](./getting-started.md).
