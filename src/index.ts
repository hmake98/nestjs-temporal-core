import 'reflect-metadata';

export * from './decorators';

/** Main Temporal module for unified integration */
export { TemporalModule } from './temporal.module';

/** Health check module for Temporal components monitoring */
export { TemporalHealthModule } from './health/temporal-health.module';
export { TemporalHealthController } from './health/temporal-health.controller';

/** Unified service providing all Temporal functionality */
export { TemporalService } from './services/temporal.service';

/** Service for Temporal client operations (start workflows, signals, queries) */
export { TemporalClientService } from './services/temporal-client.service';

/** Service for worker lifecycle management */
export { TemporalWorkerManagerService } from './services/temporal-worker.service';

/** Service for workflow discovery and introspection */
export { TemporalDiscoveryService } from './services/temporal-discovery.service';

/** Service for activity metadata and validation */
export { TemporalMetadataAccessor } from './services/temporal-metadata.service';

/** Service for schedule management */
export { TemporalScheduleService } from './services/temporal-schedule.service';

/** Typed workflow proxy — factory service, interface, and class */
export { WorkflowProxyFactory, IWorkflowProxy, WorkflowProxy } from './workflow-proxy';

/** All utility functions (validation, metadata, logging) */
export * from './utils';

/** All interfaces and types */
export * from './interfaces';

/** Essential constants and predefined values */
export {
    DEFAULT_NAMESPACE,
    DEFAULT_TASK_QUEUE,
    DEFAULT_CONNECTION_TIMEOUT_MS,
    TEMPORAL_ACTIVITY,
    TEMPORAL_ACTIVITY_METHOD,
    TEMPORAL_SIGNAL_METHOD,
    TEMPORAL_QUERY_METHOD,
    TEMPORAL_UPDATE_METHOD,
    WORKFLOW_PARAMS_METADATA,
    TEMPORAL_CLIENT,
    TEMPORAL_MODULE_OPTIONS,
    TEMPORAL_CONNECTION,
    TIMEOUTS,
    RETRY_POLICIES,
} from './constants';
