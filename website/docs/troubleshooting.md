---
id: troubleshooting
title: Troubleshooting
---

## Common Issues and Solutions

### 1. Connection Errors

**Problem:** Cannot connect to Temporal server

**Solutions:**
```typescript
// Check connection configuration
const health = temporalService.getHealth();
console.log('Connection status:', health.client.connectionStatus);

// Verify Temporal server is running
// docker ps | grep temporal

// Check connection settings
TemporalModule.register({
  connection: {
    address: process.env.TEMPORAL_ADDRESS || 'localhost:7233',
    namespace: 'default',
  },
})
```

### 2. Activity Not Found

**Problem:** Workflow cannot find registered activities

**Solutions:**
```typescript
// 1. Ensure activity is in activityClasses array
TemporalModule.register({
  worker: {
    activityClasses: [MyActivity], // Must include the activity class
  },
})

// 2. Verify activity is registered as provider
@Module({
  providers: [MyActivity], // Must be in providers array
})

// 3. Check activity decorator
@Activity({ name: 'my-activities' })
export class MyActivity {
  @ActivityMethod('myActivity')
  async myActivity() { }
}

// 4. Check discovery status
const health = temporalService.getHealth();
console.log('Activities discovered:', health.discovery.activitiesDiscovered);
```

### 3. Workflow Registration Issues

**Problem:** Workflow not found or not executing

**Solutions:**
```typescript
// 1. Ensure workflowsPath is correct
TemporalModule.register({
  worker: {
    workflowsPath: require.resolve('./workflows'), // Must resolve to workflows file/directory
  },
})

// 2. Export workflow function properly
// workflows/index.ts
export { processOrderWorkflow } from './order.workflow';
export { reportWorkflow } from './report.workflow';

// 3. Use correct workflow name when starting
await temporal.startWorkflow(
  'processOrderWorkflow', // Must match exported function name
  [args],
  options
);
```

### 4. Timeout Issues

**Problem:** Activities or workflows timing out

**Solutions:**
```typescript
// Configure appropriate timeouts
const activities = proxyActivities<typeof MyActivity.prototype>({
  startToCloseTimeout: '10m',    // Increase for long-running activities
  scheduleToCloseTimeout: '15m', // Total time including queuing
  scheduleToStartTimeout: '5m',  // Time waiting in queue
});

// For workflows
await temporal.startWorkflow('myWorkflow', [args], {
  workflowExecutionTimeout: '24h', // Max total execution time
  workflowRunTimeout: '12h',       // Max single run time
  workflowTaskTimeout: '10s',      // Decision task timeout
});
```

### 5. `Must use import to load ES Module` in Jest (NestJS 12)

NestJS 12 is ESM-only, and Jest cannot `require()` it by default.

```
Must use import to load ES Module: node_modules/@nestjs/common/...
```

Run Jest on Node 24.9+ with `node --experimental-vm-modules node_modules/jest/bin/jest.js`, or stay on NestJS 11 for Node 20/22. At runtime (not under Jest), your app needs Node 20.19+ or 22.12+. See [Testing with NestJS 12](./testing.md#testing-with-nestjs-12).

## Debug Mode

Enable comprehensive debugging:

```typescript
TemporalModule.register({
  logLevel: 'debug',
  enableLogger: true,
  connection: {
    address: 'localhost:7233',
  },
  worker: {
    debugMode: true, // If available
  },
})

// Check detailed health and statistics
const health = temporalService.getHealth();
const stats = temporalService.getStatistics();
console.log('Health:', JSON.stringify(health, null, 2));
console.log('Stats:', JSON.stringify(stats, null, 2));
```

## Getting Help

If you're still experiencing issues:

1. **Check the logs** - Enable debug logging to see detailed information
2. **Verify configuration** - Double-check all connection and worker settings
3. **Test connectivity** - Ensure Temporal server is accessible
4. **Review health status** - Use `getHealth()` to identify failing components
5. **Check GitHub Issues** - [Search existing issues](https://github.com/hmake98/nestjs-temporal-core/issues)
6. **Create an issue** - Provide logs, configuration, and minimal reproduction

Next: [Migration Guide](./migration-guide.md).
