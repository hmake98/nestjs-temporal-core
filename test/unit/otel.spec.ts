import { createTemporalOpenTelemetry, prometheusTelemetry } from '../../src/otel';

describe('createTemporalOpenTelemetry', () => {
    const resource: any = { attributes: {} };
    const spanProcessor: any = {
        onStart: jest.fn(),
        onEnd: jest.fn(),
        forceFlush: jest.fn(),
        shutdown: jest.fn(),
    };

    it('provides client, activity and workflow interceptors plus the span sink', () => {
        const otel = createTemporalOpenTelemetry({ resource, spanProcessor });

        expect(otel.client.workflow).toHaveLength(1);
        expect(otel.worker.interceptors?.activity).toHaveLength(1);
        expect(otel.worker.interceptors?.workflowModules).toEqual([
            otel.workflowInterceptorsModule,
        ]);
        expect(otel.workflowInterceptorsModule).toMatch(/workflow-interceptors/);
        expect(Object.keys(otel.worker.sinks ?? {})).toEqual(['exporter']);
    });

    it('activity factory yields inbound and outbound interceptors', () => {
        const otel = createTemporalOpenTelemetry({ resource, spanProcessor });
        const factory: any = otel.worker.interceptors?.activity?.[0];

        const made = factory({ info: {} });

        expect(typeof made.inbound.execute).toBe('function');
        expect(typeof made.outbound.getLogAttributes).toBe('function');
    });
});

describe('prometheusTelemetry', () => {
    it('exposes core metrics on the given address', () => {
        expect(prometheusTelemetry('0.0.0.0:9464')).toEqual({
            metrics: { prometheus: { bindAddress: '0.0.0.0:9464' } },
        });
    });
});
