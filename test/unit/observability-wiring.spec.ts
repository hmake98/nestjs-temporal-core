import { Logger } from '@nestjs/common';
import { Client, Connection } from '@temporalio/client';
import { NativeConnection, Runtime } from '@temporalio/worker';
import { runWithCorrelationId } from '../../src/observability/correlation';
import { resetRuntimeInstallState } from '../../src/observability/runtime';
import { TemporalConnectionFactory } from '../../src/providers/temporal-connection.factory';
import { createLogger, LoggerUtils, TemporalLogger } from '../../src/utils/logger';

jest.mock('@temporalio/client', () => ({
    Client: jest.fn(),
    Connection: { lazy: jest.fn() },
}));
jest.mock('@temporalio/worker', () => ({
    NativeConnection: { connect: jest.fn() },
    Runtime: { install: jest.fn() },
}));

describe('connection factory wiring', () => {
    const base = { connection: { address: 'localhost:7233', namespace: 'ns' } };

    beforeEach(() => {
        jest.clearAllMocks();
        resetRuntimeInstallState();
        (Connection.lazy as jest.Mock).mockResolvedValue({});
        (NativeConnection.connect as jest.Mock).mockResolvedValue({});
    });

    it('installs the runtime before creating the client', async () => {
        await new TemporalConnectionFactory().createClient({
            ...base,
            runtime: { logger: 'nest' },
        });

        expect(Runtime.install).toHaveBeenCalledTimes(1);
        const runtimeOrder = (Runtime.install as jest.Mock).mock.invocationCallOrder[0];
        const connectOrder = (Connection.lazy as jest.Mock).mock.invocationCallOrder[0];
        expect(runtimeOrder).toBeLessThan(connectOrder);
    });

    it('installs the runtime only once across client and worker connections', async () => {
        const factory = new TemporalConnectionFactory();
        const options = { ...base, runtime: { logger: 'nest' as const } };

        await factory.createClient(options);
        await factory.createWorkerConnection(options);

        expect(Runtime.install).toHaveBeenCalledTimes(1);
    });

    it('does not touch the runtime when the option is absent', async () => {
        await new TemporalConnectionFactory().createClient(base);

        expect(Runtime.install).not.toHaveBeenCalled();
    });

    it('adds the correlation interceptor to the client, after the user ones', async () => {
        const mine = { start: jest.fn() };

        await new TemporalConnectionFactory().createClient({
            connection: { ...base.connection, interceptors: { workflow: [mine] } },
            correlation: true,
        });

        const args = (Client as unknown as jest.Mock).mock.calls[0][0];
        expect(args.interceptors.workflow).toHaveLength(2);
        expect(args.interceptors.workflow[0]).toBe(mine);
    });

    it('leaves client interceptors alone when correlation is off', async () => {
        const interceptors = { workflow: [{ start: jest.fn() }] };

        await new TemporalConnectionFactory().createClient({
            connection: { ...base.connection, interceptors },
        });

        expect((Client as unknown as jest.Mock).mock.calls[0][0].interceptors).toBe(interceptors);
    });
});

describe('logger redaction and correlation', () => {
    let nestLog: jest.SpyInstance;

    beforeEach(() => {
        nestLog = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    });

    afterEach(() => jest.restoreAllMocks());

    it('redacts structured messages and extra keys, without mutating the input', () => {
        const logger = new TemporalLogger('T', { redactKeys: ['ssn'] });
        const input = { apiKey: 'sk', ssn: '1', ok: 'y' };

        logger.log(input);

        expect(nestLog).toHaveBeenCalledWith(
            { apiKey: '[REDACTED]', ssn: '[REDACTED]', ok: 'y' },
            'T',
        );
        expect(input.apiKey).toBe('sk');
    });

    it('passes strings and Errors through untouched', () => {
        const logger = new TemporalLogger('T');
        const error = new Error('x');

        logger.log('plain');
        logger.log(error);

        expect(nestLog).toHaveBeenNthCalledWith(1, 'plain', 'T');
        expect(nestLog).toHaveBeenNthCalledWith(2, error, 'T');
    });

    it('tags string messages with the active correlation id only', () => {
        const logger = new TemporalLogger('T');

        logger.log('before');
        runWithCorrelationId('req-9', () => logger.log('inside'));

        expect(nestLog).toHaveBeenNthCalledWith(1, 'before', 'T');
        expect(nestLog).toHaveBeenNthCalledWith(2, 'inside [correlationId=req-9]', 'T');
    });

    it.each(['warn', 'debug', 'verbose'] as const)('%s also redacts and tags', (level) => {
        const spy = jest.spyOn(Logger.prototype, level).mockImplementation();
        const logger = new TemporalLogger('T', { logLevel: 'verbose' });

        runWithCorrelationId('c1', () => logger[level]('msg'));
        logger[level]({ token: 't' });

        expect(spy).toHaveBeenNthCalledWith(1, 'msg [correlationId=c1]', 'T');
        expect(spy).toHaveBeenNthCalledWith(2, { token: '[REDACTED]' }, 'T');
    });

    it('error() formats the message and keeps the stack', () => {
        const spy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
        const logger = new TemporalLogger('T');

        runWithCorrelationId('c2', () => logger.error('bad', new Error('boom')));

        expect(spy).toHaveBeenCalledWith('bad [correlationId=c2]', expect.any(String), 'T');
    });

    it('muted errors are formatted too', () => {
        const spy = jest.spyOn(Logger.prototype, 'debug').mockImplementation();
        const logger = new TemporalLogger('T', { muteErrors: true, logLevel: 'debug' });

        runWithCorrelationId('c3', () => logger.error('quiet'));

        expect(spy).toHaveBeenCalledWith('[muted error] quiet [correlationId=c3]', 'T');
    });

    it('logServiceInit never prints secrets', () => {
        const spy = jest.spyOn(Logger.prototype, 'debug').mockImplementation();
        const logger = createLogger('Init', { logLevel: 'debug' });

        LoggerUtils.logServiceInit(logger, 'Svc', { apiKey: 'sk-live', address: 'a' });

        const printed = String(spy.mock.calls[0][0]) + String(spy.mock.calls[0][1]);
        expect(printed).not.toContain('sk-live');
        expect(printed).toContain('[REDACTED]');
    });
});

describe('security wiring', () => {
    const dataConverter = { payloadCodecs: [] };

    beforeEach(() => {
        jest.clearAllMocks();
        (Connection.lazy as jest.Mock).mockResolvedValue({});
    });

    it('applies the module-level dataConverter to the client', async () => {
        await new TemporalConnectionFactory().createClient({
            connection: { address: 'localhost:7233' },
            dataConverter,
        });

        expect((Client as unknown as jest.Mock).mock.calls[0][0].dataConverter).toBe(dataConverter);
    });

    it('lets connection.dataConverter win over the module-level one', async () => {
        const specific = { payloadCodecs: [] };

        await new TemporalConnectionFactory().createClient({
            connection: { address: 'localhost:7233', dataConverter: specific },
            dataConverter,
        });

        expect((Client as unknown as jest.Mock).mock.calls[0][0].dataConverter).toBe(specific);
    });

    it('strictSecurity fails client creation for a plaintext remote connection', async () => {
        await expect(
            new TemporalConnectionFactory().createClient({
                connection: { address: 'prod.example.com:7233' },
                strictSecurity: true,
            }),
        ).rejects.toThrow(/strictSecurity/);
        expect(Connection.lazy).not.toHaveBeenCalled();
    });

    it('strictSecurity also guards the worker connection', async () => {
        await expect(
            new TemporalConnectionFactory().createWorkerConnection({
                connection: { address: 'prod.example.com:7233' },
                strictSecurity: true,
            }),
        ).rejects.toThrow(/strictSecurity/);
    });
});
