import { trace } from '@opentelemetry/api';
import { Resource } from '@opentelemetry/resources';
import { ConsoleSpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { createTemporalOpenTelemetry } from 'nestjs-temporal-core/otel';

/**
 * Optional tracing: set OTEL=1 and spans print to the console. In production swap the exporter
 * for OTLP. One trace then spans HTTP -> client -> workflow -> activity.
 * Call before TemporalModule is built (it runs when this module is imported by AppModule).
 */
export function setupTelemetry(serviceName: string) {
  if (!process.env.OTEL) return undefined;

  const resource = new Resource({ 'service.name': serviceName });
  const spanProcessor = new SimpleSpanProcessor(new ConsoleSpanExporter());
  const provider = new NodeTracerProvider({ resource });
  provider.addSpanProcessor(spanProcessor);
  provider.register();
  void trace; // the global tracer provider is now set

  return createTemporalOpenTelemetry({ resource, spanProcessor });
}
