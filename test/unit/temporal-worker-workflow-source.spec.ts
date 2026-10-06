import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TemporalModule } from '../../src/temporal.module';
import { TemporalWorkerManagerService } from '../../src/services/temporal-worker.service';

const buildWorkflowBundle = jest.fn();
jest.mock('../../src/workflow-bundle', () => ({
    ...jest.requireActual('../../src/workflow-bundle'),
    buildWorkflowBundle: (...args: unknown[]) => buildWorkflowBundle(...args),
}));

describe('TemporalWorkerManagerService workflow source (autoBundle / path resolution)', () => {
    let service: any;
    let warn: jest.Mock;
    let dir: string;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfs-'));
        buildWorkflowBundle.mockReset();
        service = new TemporalWorkerManagerService({} as any, { taskQueue: 'q' } as any, null);
        warn = jest.fn();
        service.logger = { warn, info: jest.fn(), verbose: jest.fn(), debug: jest.fn() };
    });

    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('autoBundle: bundles the resolved path and sets workflowBundle only', async () => {
        const file = path.join(dir, 'workflows.js');
        fs.writeFileSync(file, '');
        buildWorkflowBundle.mockResolvedValue({
            code: 'CODE',
            hash: 'a'.repeat(40),
            cached: false,
        });
        const config: any = {};

        const result = await service.applyWorkflowSource(config, {
            workflowsPath: path.join(dir, 'workflows.ts'),
            autoBundle: { cacheDir: 'c' },
        });

        expect(result).toBe(true);
        expect(buildWorkflowBundle).toHaveBeenCalledWith(file, {
            cacheDir: 'c',
            bundlerOptions: { workflowInterceptorModules: [] },
        });
        expect(config).toEqual({ workflowBundle: { code: 'CODE' } });
    });

    it('autoBundle: true uses default options and reports cache hits', async () => {
        const file = path.join(dir, 'w.ts');
        fs.writeFileSync(file, '');
        buildWorkflowBundle.mockResolvedValue({ code: 'C', hash: 'b'.repeat(40), cached: true });
        await service.applyWorkflowSource({}, { workflowsPath: file, autoBundle: true });
        expect(buildWorkflowBundle).toHaveBeenCalledWith(file, {
            bundlerOptions: { workflowInterceptorModules: [] },
        });
        expect(service.logger.info).toHaveBeenCalledWith(
            expect.stringContaining('loaded from cache'),
        );
    });

    it('autoBundle: moves worker interceptor modules into the bundle (SDK ignores them with a bundle)', async () => {
        const file = path.join(dir, 'w.ts');
        fs.writeFileSync(file, '');
        buildWorkflowBundle.mockResolvedValue({ code: 'C', hash: 'c'.repeat(40), cached: false });
        const config: any = {
            interceptors: {
                activity: ['a'],
                workflowModules: ['/mods/correlation.js', '/mods/dup.js'],
            },
        };

        await service.applyWorkflowSource(config, {
            workflowsPath: file,
            autoBundle: {
                bundlerOptions: { workflowInterceptorModules: ['/mods/dup.js', '/mods/own.js'] },
            },
        });

        expect(
            buildWorkflowBundle.mock.calls[0][1].bundlerOptions.workflowInterceptorModules,
        ).toEqual(['/mods/dup.js', '/mods/own.js', '/mods/correlation.js']);
        // Left on the worker options the SDK would warn and ignore them.
        expect(config.interceptors.workflowModules).toBeUndefined();
        expect(config.interceptors.activity).toEqual(['a']);
    });

    it('autoBundle: a missing path is a hard error', async () => {
        await expect(
            service.applyWorkflowSource(
                {},
                { workflowsPath: path.join(dir, 'missing'), autoBundle: true },
            ),
        ).rejects.toThrow(/was not found/);
        expect(buildWorkflowBundle).not.toHaveBeenCalled();
    });

    it('plain path: uses the swapped extension that exists', async () => {
        const js = path.join(dir, 'workflows.js');
        fs.writeFileSync(js, '');
        const config: any = {};
        await service.applyWorkflowSource(config, {
            workflowsPath: path.join(dir, 'workflows.ts'),
        });
        expect(config.workflowsPath).toBe(js);
        expect(warn).not.toHaveBeenCalled();
    });

    it('plain path: a missing path only warns and is passed through unchanged', async () => {
        const config: any = {};
        const missing = path.join(dir, 'missing');
        await expect(service.applyWorkflowSource(config, { workflowsPath: missing })).resolves.toBe(
            true,
        );
        expect(config.workflowsPath).toBe(missing);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('was not found'));
    });

    it('workflowBundle passes through; nothing configured returns false', async () => {
        const config: any = {};
        await expect(
            service.applyWorkflowSource(config, { workflowBundle: { codePath: 'x' } }),
        ).resolves.toBe(true);
        expect(config.workflowBundle).toEqual({ codePath: 'x' });
        await expect(service.applyWorkflowSource({}, {})).resolves.toBe(false);
    });

    it('reports an autoBundle worker as a bundle source', () => {
        expect(service.getWorkflowSource({ workflowsPath: 'x', autoBundle: true })).toBe('bundle');
        expect(service.getWorkflowSource({ workflowsPath: 'x' })).toBe('filesystem');
    });

    describe('TemporalModule.register validation', () => {
        const base = { connection: { address: 'localhost:7233' }, taskQueue: 'q' };

        it('rejects autoBundle without workflowsPath', () => {
            expect(() =>
                TemporalModule.register({ ...base, worker: { autoBundle: true } }),
            ).toThrow('worker: autoBundle requires workflowsPath');
        });

        it('rejects autoBundle on a workers[] entry with workflowBundle', () => {
            expect(() =>
                TemporalModule.register({
                    ...base,
                    workers: [{ taskQueue: 'w', autoBundle: true, workflowBundle: {} }],
                }),
            ).toThrow('workers[w]: autoBundle cannot be combined with workflowBundle');
        });

        it('accepts a valid autoBundle config', () => {
            expect(() =>
                TemporalModule.register({
                    ...base,
                    worker: { workflowsPath: './workflows', autoBundle: true },
                }),
            ).not.toThrow();
        });
    });
});
