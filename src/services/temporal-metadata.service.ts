import { Injectable } from '@nestjs/common';
import {
    TEMPORAL_ACTIVITY,
    TEMPORAL_ACTIVITY_METHOD,
    TEMPORAL_SIGNAL_METHOD,
    TEMPORAL_QUERY_METHOD,
    TEMPORAL_UPDATE_METHOD,
    TEMPORAL_CHILD_WORKFLOW,
} from '../constants';
import { bindActivityHandler } from '../error-mapping/non-retryable.decorator';
import { createLogger, TemporalLogger } from '../utils/logger';
import {
    ActivityMethodMetadataResult,
    ActivityMetadataExtractionResult,
    ActivityClassValidationResult,
    MetadataValidationResult,
    ActivityInfoResult,
    CacheStatsResult,
    SignalMethodExtractionResult,
    QueryMethodExtractionResult,
    UpdateMethodExtractionResult,
    ChildWorkflowExtractionResult,
} from '../interfaces';

/**
 * Temporal Metadata Accessor Service
 *
 * Provides utilities for extracting and validating Temporal metadata
 * from classes and methods decorated with Temporal decorators.
 */
@Injectable()
export class TemporalMetadataAccessor {
    private readonly logger: TemporalLogger;
    private readonly activityMethodCache = new Map<Function, Map<string, unknown>>();

    constructor() {
        this.logger = createLogger(TemporalMetadataAccessor.name);
    }

    /**
     * Check if a class is marked as a Temporal activity
     */
    isActivity(target: Function): boolean {
        try {
            return (
                Reflect.hasMetadata(TEMPORAL_ACTIVITY, target) ||
                Reflect.hasMetadata(TEMPORAL_ACTIVITY, target.prototype)
            );
        } catch {
            return false;
        }
    }

    /**
     * Check if a method is marked as a Temporal activity method
     */
    isActivityMethod(target: object | null | undefined | string, methodName?: string): boolean {
        try {
            if (!target || typeof target === 'string') return false;

            const targetObj = target as { constructor?: { prototype?: object } };
            return (
                Reflect.hasMetadata(TEMPORAL_ACTIVITY_METHOD, target, methodName || '') ||
                (targetObj.constructor?.prototype !== undefined &&
                    Reflect.hasMetadata(
                        TEMPORAL_ACTIVITY_METHOD,
                        targetObj.constructor.prototype,
                        methodName || '',
                    ))
            );
        } catch {
            return false;
        }
    }

    /**
     * Get activity metadata from a class
     */
    getActivityMetadata(target: Function): unknown {
        try {
            return (
                Reflect.getMetadata(TEMPORAL_ACTIVITY, target) ||
                Reflect.getMetadata(TEMPORAL_ACTIVITY, target.prototype) ||
                null
            );
        } catch {
            return null;
        }
    }

    /**
     * Get activity method metadata from an instance and method name
     */
    getActivityMethodMetadata(
        instance: unknown,
        methodName: string,
    ): ActivityMethodMetadataResult | null {
        try {
            if (!instance) return null;

            const prototype = Object.getPrototypeOf(instance);
            if (!prototype) return null;

            const metadata = Reflect.getMetadata(TEMPORAL_ACTIVITY_METHOD, prototype, methodName);
            if (!metadata) return null;

            // Check if the method actually exists on the prototype
            if (!(methodName in prototype)) return null;

            return {
                name: metadata.name || methodName,
                originalName: methodName,
                methodName,
                className: prototype.constructor?.name || 'Unknown',
                options: metadata.options || metadata, // Include the full metadata as options if no specific options property
                handler: prototype[methodName],
            };
        } catch {
            return null;
        }
    }

    /**
     * Get activity method names from a class
     */
    getActivityMethodNames(target: Function | null | undefined | string): string[] {
        try {
            if (!target || typeof target !== 'function' || !target.prototype) return [];

            const prototype = target.prototype;
            const propertyNames = Object.getOwnPropertyNames(prototype);
            const methodNames: string[] = [];

            for (const propertyName of propertyNames) {
                if (propertyName === 'constructor') continue;

                try {
                    if (Reflect.hasMetadata(TEMPORAL_ACTIVITY_METHOD, prototype, propertyName)) {
                        methodNames.push(propertyName);
                    }
                } catch {
                    // Skip this method if metadata access fails
                }
            }

            return methodNames;
        } catch {
            return [];
        }
    }

    /**
     * Get activity method name from metadata
     */
    getActivityMethodName(
        target: object | null | undefined | string,
        methodName?: string,
    ): string | null {
        try {
            if (!target || typeof target === 'string') return null;

            const metadata = this.getActivityMethodMetadata(target, methodName || '');
            return metadata?.name || methodName || null;
        } catch {
            return null;
        }
    }

    /**
     * Get activity options from a class
     */
    getActivityOptions(target: Function): Record<string, unknown> | null {
        try {
            const metadata = this.getActivityMetadata(target) as Record<string, unknown> | null;
            return metadata || null;
        } catch {
            return null;
        }
    }

    /**
     * Extract activity methods from an instance
     */
    extractActivityMethods(instance: unknown): ActivityMetadataExtractionResult {
        const errors: Array<{ method: string; error: string }> = [];
        const methods = new Map<string, ActivityMethodMetadataResult>();
        let extractedCount = 0;

        if (!instance) {
            return {
                success: true,
                methods,
                errors,
                extractedCount: 0,
            };
        }

        // Check cache first
        const constructor = (instance as { constructor?: Function }).constructor;
        if (constructor && this.activityMethodCache.has(constructor)) {
            const cachedMethods = this.activityMethodCache.get(constructor) as Map<string, unknown>;
            // Convert cached methods to new format
            for (const [name, method] of cachedMethods.entries()) {
                if (typeof method === 'function') {
                    methods.set(name, {
                        name,
                        originalName: name,
                        methodName: name,
                        className: constructor.name || 'Unknown',
                        handler: method,
                    });
                    extractedCount++;
                } else if (method && typeof method === 'object') {
                    methods.set(name, method as ActivityMethodMetadataResult);
                    extractedCount++;
                }
            }
            return {
                success: true,
                methods,
                errors,
                extractedCount,
            };
        }

        try {
            const prototype = Object.getPrototypeOf(instance);
            if (!prototype) {
                this.logger.warn('No prototype found for instance');
                return {
                    success: false,
                    methods,
                    errors: [{ method: 'prototype', error: 'No prototype found for instance' }],
                    extractedCount: 0,
                };
            }

            // First, try to get activity methods stored as a collection on the prototype
            const storedActivityMethods = Reflect.getMetadata(TEMPORAL_ACTIVITY_METHOD, prototype);
            if (storedActivityMethods && typeof storedActivityMethods === 'object') {
                for (const [methodName, methodMetadata] of Object.entries(storedActivityMethods)) {
                    try {
                        if (typeof prototype[methodName] === 'function') {
                            const metadata = methodMetadata as Record<string, unknown>;
                            const activityName = (metadata.name as string) || methodName;

                            methods.set(activityName, {
                                name: activityName,
                                originalName: methodName,
                                methodName: methodName,
                                className: prototype.constructor?.name || 'Unknown',
                                options: {
                                    name: activityName,
                                    methodName: methodName,
                                    className: prototype.constructor?.name || 'Unknown',
                                    ...metadata, // Spread the full metadata into options
                                },
                                handler: bindActivityHandler(prototype, methodName, instance),
                            });
                            extractedCount++;
                            this.logger.debug(`Found activity method: ${activityName}`);
                        }
                    } catch (methodError) {
                        const errorMessage =
                            methodError instanceof Error ? methodError.message : 'Unknown error';
                        errors.push({ method: methodName, error: errorMessage });
                        this.logger.warn(`Failed to process method ${methodName}`, methodError);
                    }
                }
            } else {
                // Fallback: check individual properties for metadata (backwards compatibility)
                const propertyNames = Object.getOwnPropertyNames(prototype);

                for (const propertyName of propertyNames) {
                    if (propertyName === 'constructor') continue;

                    try {
                        const methodMetadata = Reflect.getMetadata(
                            TEMPORAL_ACTIVITY_METHOD,
                            prototype,
                            propertyName,
                        );

                        if (methodMetadata && typeof prototype[propertyName] === 'function') {
                            const activityName =
                                ((methodMetadata as Record<string, unknown>).name as string) ||
                                propertyName;

                            methods.set(activityName, {
                                name: activityName,
                                originalName: propertyName,
                                methodName: propertyName,
                                className: prototype.constructor?.name || 'Unknown',
                                options: {
                                    name: activityName,
                                    methodName: propertyName,
                                    className: prototype.constructor?.name || 'Unknown',
                                    ...methodMetadata, // Spread the full metadata into options
                                },
                                handler: bindActivityHandler(prototype, propertyName, instance),
                            });
                            extractedCount++;
                            this.logger.debug(`Found activity method: ${activityName}`);
                        }
                    } catch (error) {
                        const errorMessage =
                            error instanceof Error ? error.message : 'Unknown error';
                        errors.push({ method: propertyName, error: errorMessage });
                        this.logger.warn(`Failed to process method ${propertyName}`, error);
                    }
                }
            }

            // Cache the results
            if (constructor) {
                this.activityMethodCache.set(constructor, methods);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            this.logger.error('Failed to extract activity methods', error);
            errors.push({ method: 'extraction', error: errorMessage });
        }

        return {
            success: errors.length === 0,
            methods,
            errors,
            extractedCount,
        };
    }

    /**
     * Extract activity methods from a class constructor (overload for TemporalService)
     */
    extractActivityMethodsFromClass(target: Function): Array<{
        methodName: string;
        name: string;
        metadata: {
            name: string;
            methodName: string;
            className: string;
            options?: Record<string, unknown>;
        };
    }> {
        const methods: Array<{
            methodName: string;
            name: string;
            metadata: {
                name: string;
                methodName: string;
                className: string;
                options?: Record<string, unknown>;
            };
        }> = [];

        try {
            const prototype = target.prototype;
            const prototypeMetadata = Reflect.getMetadata(TEMPORAL_ACTIVITY_METHOD, prototype);

            if (prototypeMetadata && typeof prototypeMetadata === 'object') {
                for (const [methodName, metadata] of Object.entries(prototypeMetadata)) {
                    const metadataObj = metadata as Record<string, unknown>;
                    methods.push({
                        methodName,
                        name: (metadataObj.name as string) || methodName,
                        metadata: {
                            name: (metadataObj.name as string) || methodName,
                            methodName,
                            className: target.name || 'Unknown',
                            options: metadataObj.options as Record<string, unknown> | undefined,
                        },
                    });
                }
            }
        } catch (error) {
            this.logger.warn('Failed to extract activity methods from class', error);
        }

        return methods;
    }

    /**
     * Extract methods from prototype (alias for extractActivityMethods)
     */
    extractMethodsFromPrototype(instance: unknown): ActivityMetadataExtractionResult {
        return this.extractActivityMethods(instance);
    }

    /**
     * Get method options for an activity method on a prototype
     */
    getActivityMethodOptions(target: unknown, methodName?: string): Record<string, unknown> | null {
        try {
            if (!target || !methodName) return null;

            const metadata = Reflect.getMetadata(TEMPORAL_ACTIVITY_METHOD, target, methodName);
            return metadata || null;
        } catch {
            return null;
        }
    }

    /**
     * Get signal methods from a prototype
     */
    getSignalMethods(prototype: unknown): SignalMethodExtractionResult {
        try {
            const methods = Reflect.getMetadata(TEMPORAL_SIGNAL_METHOD, prototype as object) || {};
            return {
                success: true,
                methods: methods as Record<string, string>,
                errors: [],
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            return {
                success: false,
                methods: {},
                errors: [{ method: 'signal', error: errorMessage }],
            };
        }
    }

    /**
     * Get query methods from a prototype
     */
    getQueryMethods(prototype: unknown): QueryMethodExtractionResult {
        try {
            const methods = Reflect.getMetadata(TEMPORAL_QUERY_METHOD, prototype as object) || {};
            return {
                success: true,
                methods: methods as Record<string, string>,
                errors: [],
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            return {
                success: false,
                methods: {},
                errors: [{ method: 'query', error: errorMessage }],
            };
        }
    }

    /**
     * Get update methods from a prototype
     */
    getUpdateMethods(prototype: unknown): UpdateMethodExtractionResult {
        try {
            const methods = Reflect.getMetadata(TEMPORAL_UPDATE_METHOD, prototype as object) || {};
            return {
                success: true,
                methods: methods as Record<string, string>,
                errors: [],
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            return {
                success: false,
                methods: {},
                errors: [{ method: 'update', error: errorMessage }],
            };
        }
    }

    /**
     * Get child workflows from a prototype
     */
    getChildWorkflows(prototype: unknown): ChildWorkflowExtractionResult {
        try {
            const workflows =
                Reflect.getMetadata(TEMPORAL_CHILD_WORKFLOW, prototype as object) || {};
            return {
                success: true,
                workflows: workflows as Record<string, unknown>,
                errors: [],
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            return {
                success: false,
                workflows: {},
                errors: [{ workflow: 'child', error: errorMessage }],
            };
        }
    }

    /**
     * Validate an activity class
     */
    validateActivityClass(constructor: Function): ActivityClassValidationResult {
        const issues: string[] = [];
        const warnings: string[] = [];

        try {
            const className = constructor.name || 'Unknown';
            const prototype = constructor.prototype;
            const methodCount = this.getActivityMethodNames(constructor).length;

            // Check if class has activity metadata
            if (!this.isActivity(constructor)) {
                issues.push('Class is not marked with @Activity decorator');
            }

            // Check for activity methods
            const hasActivityMethods = this.hasActivityMethods(prototype);

            if (!hasActivityMethods) {
                issues.push('Activity class has no methods marked with @ActivityMethod');
            }

            // Add warnings for potential issues
            if (methodCount === 0) {
                warnings.push('No activity methods found in class');
            }

            if (methodCount > 50) {
                warnings.push('Class has many activity methods, consider splitting');
            }

            return {
                isValid: issues.length === 0,
                issues,
                warnings: warnings.length > 0 ? warnings : undefined,
                className,
                methodCount,
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            issues.push(`Validation failed: ${errorMessage}`);
            return {
                isValid: false,
                issues,
                className: constructor.name || 'Unknown',
                methodCount: 0,
            };
        }
    }

    /**
     * Check if a prototype has activity methods
     */
    private hasActivityMethods(prototype: unknown): boolean {
        if (!prototype) return false;

        try {
            // Check for activity methods stored as a collection on the prototype
            const activityMethods = Reflect.getMetadata(TEMPORAL_ACTIVITY_METHOD, prototype);
            if (activityMethods && typeof activityMethods === 'object') {
                return Object.keys(activityMethods).length > 0;
            }

            // Fallback: check individual property metadata (for backwards compatibility)
            const propertyNames = Object.getOwnPropertyNames(prototype);
            return propertyNames.some((propertyName) => {
                if (propertyName === 'constructor') return false;

                try {
                    return Reflect.hasMetadata(TEMPORAL_ACTIVITY_METHOD, prototype, propertyName);
                } catch {
                    return false;
                }
            });
        } catch {
            return false;
        }
    }

    /**
     * Get all metadata keys for debugging
     */
    getAllMetadataKeys(target: unknown): string[] {
        try {
            return Reflect.getMetadataKeys(target as object);
        } catch {
            return [];
        }
    }

    /**
     * Get activity name from class metadata
     */
    getActivityName(target: Function): string | null {
        try {
            const metadata = this.getActivityMetadata(target) as Record<string, unknown> | null;
            return (metadata?.name as string) || target.name || null;
        } catch {
            return null;
        }
    }

    /**
     * Get activity info with comprehensive details
     */
    getActivityInfo(target: Function | null | undefined | string): ActivityInfoResult {
        try {
            if (!target || typeof target !== 'function') {
                // Return a default structure for null/undefined/invalid targets
                return {
                    className: 'Unknown',
                    isActivity: false,
                    activityName: null,
                    methodNames: [],
                    metadata: null,
                    activityOptions: null,
                    methodCount: 0,
                };
            }

            const className = target.name || 'Unknown';
            const isActivity = this.isActivity(target);
            const activityName = this.getActivityName(target);
            const methodNames = this.getActivityMethodNames(target);
            const metadata = this.getActivityMetadata(target);
            const activityOptions = this.getActivityOptions(target);

            return {
                className,
                isActivity,
                activityName,
                methodNames,
                metadata,
                activityOptions,
                methodCount: methodNames.length,
            };
        } catch {
            return {
                className: 'Unknown',
                isActivity: false,
                activityName: null,
                methodNames: [],
                metadata: null,
                activityOptions: null,
                methodCount: 0,
            };
        }
    }

    /**
     * Validate that required metadata exists
     */
    validateMetadata(target: unknown, expectedKeys: string[]): MetadataValidationResult {
        const missing: string[] = [];
        const present: string[] = [];
        const targetName = typeof target === 'function' ? target.name || 'Unknown' : 'Unknown';

        for (const key of expectedKeys) {
            try {
                if (!Reflect.hasMetadata(key, target as object)) {
                    missing.push(key);
                } else {
                    present.push(key);
                }
            } catch {
                missing.push(key);
            }
        }

        return {
            isValid: missing.length === 0,
            missing,
            present,
            target: targetName,
        };
    }

    /**
     * Clear internal cache
     */
    clearCache(): void {
        this.activityMethodCache.clear();
    }

    /**
     * Get cache statistics
     */
    getCacheStats(): CacheStatsResult {
        const entries = Array.from(this.activityMethodCache.keys()).map((k) => k.name || 'Unknown');
        return {
            size: this.activityMethodCache.size,
            entries,
            message: 'Cache statistics not available',
            note: 'WeakMap-based caching prevents memory leaks but limits size reporting',
            hitRate: 0, // Not tracked in current implementation
            missRate: 0, // Not tracked in current implementation
        };
    }
}
