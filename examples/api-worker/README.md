# api-worker example

An HTTP API and a Temporal worker built on `nestjs-temporal-core`, as two processes sharing one config.

```
POST /orders             -> starts orderWorkflow (workflow id = order-<id>)
POST /orders/:id/approve -> signal
POST /orders/:id/cancel  -> signal
GET  /orders/:id         -> query (status)
```

The workflow reserves stock, waits up to an hour for approval (then cancels itself), and charges the card.

| File | Shows |
| --- | --- |
| `src/orders/orders.workflows.ts` | A sandboxed workflow: signals, a query, a timer. Imports only `@temporalio/workflow`. |
| `src/orders/orders.activities.ts` | Activities as Nest providers with DI; `@NonRetryable()` for a declined card. |
| `src/orders/orders.service.ts` | Starting, signaling and querying through `TemporalService`. |
| `src/temporal.config.ts` | One config for both roles: `runtime`, `correlation`, `errorMapping`, `autoBundle`, optional OpenTelemetry. |
| `src/main.ts`, `src/worker.ts` | API process (`NestFactory.create`) and worker process (`createApplicationContext`). |
| `test/` | A service test with no server, an activity test with DI, and the real workflow on a time-skipping server including a history replay. |

## Run it

```bash
temporal server start-dev            # in another terminal (https://docs.temporal.io/cli)
npm install
npm run build
npm run start:worker                 # terminal 1
npm run start:api                    # terminal 2

curl -X POST localhost:3000/orders -H 'content-type: application/json' -d '{"orderId":"42","cents":1999}'
curl localhost:3000/orders/42        # {"status":"awaiting-approval"}
curl -X POST localhost:3000/orders/42/approve
curl localhost:3000/orders/42        # {"status":"completed"}
```

`OTEL=1 npm run start:worker` (and `start:api`) prints spans for the HTTP request, client call, workflow and activities to the console; swap the exporter in `src/telemetry.ts` for OTLP.

## Test it

```bash
npm test      # first run downloads the Temporal test server binary
```

## Using it in your app

`package.json` points at `file:../..` so the example always matches this repo. In your own project install the published package instead: `npm install nestjs-temporal-core`.
