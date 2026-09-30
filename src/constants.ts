/**
 * Temporal Core Constants
 *
 * This file contains all core constants, injection tokens, metadata keys, default values,
 * timeout presets, retry policy presets, and enums used throughout the NestJS Temporal integration.
 *
 * These constants are used for configuration, dependency injection, metadata reflection,
 * and standardized values across the codebase.
 */
// ==========================================
// Injection Tokens
// ==========================================
export const ACTIVITY_MODULE_OPTIONS = 'ACTIVITY_MODULE_OPTIONS';
export const TEMPORAL_CLIENT = 'TEMPORAL_CLIENT';
export const TEMPORAL_CONNECTION = 'TEMPORAL_CONNECTION';
export const TEMPORAL_MODULE_OPTIONS = 'TEMPORAL_MODULE_OPTIONS';
export const WORKER_MODULE_OPTIONS = 'WORKER_MODULE_OPTIONS';
export const TEMPORAL_WORKFLOW_METHOD = 'TEMPORAL_WORKFLOW_METHOD';

// ==========================================
// Metadata Keys
// ==========================================
export const RUN_ID_METADATA = 'workflow:runId';
export const TASK_QUEUE_METADATA = 'workflow:taskQueue';
export const TEMPORAL_ACTIVITY = 'TEMPORAL_ACTIVITY';
export const TEMPORAL_ACTIVITY_METHOD = 'TEMPORAL_ACTIVITY_METHOD';
export const TEMPORAL_QUERY_METHOD = 'TEMPORAL_QUERY_METHOD';
export const TEMPORAL_SIGNAL_METHOD = 'TEMPORAL_SIGNAL_METHOD';
export const TEMPORAL_UPDATE_METHOD = 'TEMPORAL_UPDATE_METHOD';
export const TEMPORAL_CHILD_WORKFLOW = 'TEMPORAL_CHILD_WORKFLOW';
export const WORKFLOW_CONTEXT_METADATA = 'workflow:context';
export const WORKFLOW_ID_METADATA = 'workflow:id';
export const WORKFLOW_PARAMS_METADATA = 'workflow:params';

// ==========================================
// Default Values
// ==========================================
export const DEFAULT_CONNECTION_TIMEOUT_MS = 5000;
export const DEFAULT_NAMESPACE = 'default';
export const DEFAULT_TASK_QUEUE = 'default-task-queue';

// ==========================================
// Predefined Timeout Values
// ==========================================
export const TIMEOUTS = Object.freeze({
    ACTIVITY_LONG: '30m',
    ACTIVITY_MEDIUM: '5m',
    ACTIVITY_SHORT: '1m',
    CONNECTION_TIMEOUT: '10s',
    HEARTBEAT: '30s',
    QUERY_TIMEOUT: '5s',
    SIGNAL_TIMEOUT: '10s',
    STARTUP_TIMEOUT: '30s',
    WORKFLOW_LONG: '7d',
    WORKFLOW_MEDIUM: '24h',
    WORKFLOW_SHORT: '1h',
});

// ==========================================
// Retry Policy Presets
// ==========================================
export const RETRY_POLICIES = Object.freeze({
    AGGRESSIVE: {
        maximumAttempts: 10,
        initialInterval: '1s',
        maximumInterval: '300s',
        backoffCoefficient: 1.5,
    },
    CONSERVATIVE: {
        maximumAttempts: 3,
        initialInterval: '30s',
        maximumInterval: '600s',
        backoffCoefficient: 3.0,
    },
    QUICK: {
        maximumAttempts: 3,
        initialInterval: '1s',
        maximumInterval: '10s',
        backoffCoefficient: 2.0,
    },
    STANDARD: {
        maximumAttempts: 5,
        initialInterval: '5s',
        maximumInterval: '60s',
        backoffCoefficient: 2.0,
    },
});

// ==========================================
// Enums
// ==========================================

export enum WorkflowIdConflictPolicy {
    REJECT_DUPLICATE = 'REJECT_DUPLICATE',
    TERMINATE_IF_RUNNING = 'TERMINATE_IF_RUNNING',
    ALLOW_DUPLICATE = 'ALLOW_DUPLICATE',
}

export enum WorkflowIdReusePolicy {
    ALLOW_DUPLICATE = 0,
    ALLOW_DUPLICATE_FAILED_ONLY = 1,
    REJECT_DUPLICATE = 2,
    TERMINATE_IF_RUNNING = 3,
}
