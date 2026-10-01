import { DynamicModule, Module } from '@nestjs/common';
import { TemporalClientService } from '../services/temporal-client.service';
import { TemporalService } from '../services/temporal.service';
import { FakeTemporalClientService, FakeTemporalService } from './fake-temporal.service';
import { TemporalTestingRecorder } from './temporal-testing-recorder';

/**
 * Replaces the real Temporal providers with in-memory fakes for unit tests. Import it
 * instead of `TemporalModule`: code that injects `TemporalService` or
 * `TemporalClientService` gets a fake that records calls and needs no server.
 *
 * @example
 * ```typescript
 * const moduleRef = await Test.createTestingModule({
 *   imports: [TemporalTestingModule.register()],
 *   providers: [OrderService],
 * }).compile();
 *
 * await moduleRef.get(OrderService).place({ id: 'o1' });
 * expect(moduleRef.get(TemporalTestingRecorder).callsTo('startWorkflow')).toHaveLength(1);
 * ```
 */
@Module({})
export class TemporalTestingModule {
    static register(): DynamicModule {
        return {
            module: TemporalTestingModule,
            global: true,
            providers: [
                TemporalTestingRecorder,
                { provide: TemporalService, useClass: FakeTemporalService },
                { provide: TemporalClientService, useClass: FakeTemporalClientService },
            ],
            exports: [TemporalTestingRecorder, TemporalService, TemporalClientService],
        };
    }
}
