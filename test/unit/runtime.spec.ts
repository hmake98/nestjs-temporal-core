import { Logger } from '@nestjs/common';
import { Runtime } from '@temporalio/worker';
import {
    createNestSdkLogger,
    installRuntime,
    resetRuntimeInstallState,
} from '../../src/observability/runtime';

jest.mock('@temporalio/worker', () => ({
    ...jest.requireActual('@temporalio/worker'),
    Runtime: { install: jest.fn() },
}));

const install = Runtime.install as jest.Mock;

describe('installRuntime', () => {
    const log = { warn: jest.fn() };

    beforeEach(() => {
        resetRuntimeInstallState();
        install.mockReset();
        log.warn.mockReset();
    });

    it('does nothing when the option is absent', () => {
        expect(installRuntime(undefined, log)).toBe('none');
        expect(install).not.toHaveBeenCalled();
    });

    it('installs once; a second call is a no-op', () => {
        expect(installRuntime({ telemetry: { metrics: undefined } }, log)).toBe('installed');
        expect(installRuntime({ logger: 'nest' }, log)).toBe('skipped');
        expect(install).toHaveBeenCalledTimes(1);
    });

    it("with logger 'nest' uses a Nest-backed logger and forwards native logs", () => {
        installRuntime({ logger: 'nest' }, log);

        const options = install.mock.calls[0][0];
        expect(typeof options.logger.info).toBe('function');
        expect(options.telemetryOptions).toEqual({ logging: { forward: {} } });
    });

    it('keeps user-specified logging config instead of forcing forward', () => {
        const telemetry = { logging: { console: { format: 'json' as const } } };

        installRuntime({ logger: 'nest', telemetry }, log);

        expect(install.mock.calls[0][0].telemetryOptions).toBe(telemetry);
    });

    it('passes a custom SDK logger through untouched', () => {
        const logger = {
            log: jest.fn(),
            trace: jest.fn(),
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
        };

        installRuntime({ logger }, log);

        expect(install.mock.calls[0][0]).toEqual({ logger });
    });

    it('warns instead of throwing when the Runtime already exists (late install)', () => {
        install.mockImplementation(() => {
            throw new Error('Runtime singleton has already been instantiated');
        });

        expect(installRuntime({ logger: 'nest' }, log)).toBe('late');
        expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('already exists'));
        expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('already been instantiated'));
    });

    it('handles non-Error throws in the late-install warning', () => {
        install.mockImplementation(() => {
            throw 'boom';
        });

        expect(installRuntime({ logger: 'nest' }, log)).toBe('late');
        expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('boom'));
    });

    it('defaults to a Nest logger for warnings', () => {
        install.mockImplementation(() => {
            throw new Error('x');
        });
        const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

        installRuntime({ logger: 'nest' });

        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });
});

describe('createNestSdkLogger', () => {
    it.each([
        ['trace', 'verbose'],
        ['debug', 'debug'],
        ['info', 'log'],
        ['warn', 'warn'],
        ['error', 'error'],
    ] as const)('%s maps to Nest %s', (method, nestMethod) => {
        const spy = jest.spyOn(Logger.prototype, nestMethod).mockImplementation();

        createNestSdkLogger()[method]('hello');

        expect(spy).toHaveBeenCalledWith('hello');
        spy.mockRestore();
    });

    it('appends redacted metadata', () => {
        const spy = jest.spyOn(Logger.prototype, 'log').mockImplementation();

        createNestSdkLogger().info('connected', { apiKey: 'sk', taskQueue: 'q' });

        expect(spy).toHaveBeenCalledWith('connected {"apiKey":"[REDACTED]","taskQueue":"q"}');
        spy.mockRestore();
    });

    it('ignores empty metadata and supports log(level, ...)', () => {
        const spy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

        createNestSdkLogger().log('WARN', 'careful', {});

        expect(spy).toHaveBeenCalledWith('careful');
        spy.mockRestore();
    });
});
