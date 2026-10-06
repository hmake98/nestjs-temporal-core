import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const bundleWorkflowCode = jest.fn();
jest.mock('@temporalio/worker', () => ({
    ...jest.requireActual('@temporalio/worker'),
    bundleWorkflowCode: (...args: unknown[]) => bundleWorkflowCode(...args),
}));

import {
    buildWorkflowBundle,
    computeWorkflowBundleHash,
    resolveWorkflowsPath,
    tryResolveWorkflowsPath,
    validateAutoBundle,
} from '../../src/workflow-bundle';

describe('workflow-bundle', () => {
    let dir: string;

    const write = (rel: string, content = '') => {
        const file = path.join(dir, rel);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content);
        return file;
    };

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfb-'));
        bundleWorkflowCode.mockReset();
        bundleWorkflowCode.mockResolvedValue({ code: 'BUNDLED' });
    });

    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    describe('resolveWorkflowsPath', () => {
        it.each([
            ['absolute file', (f: string) => f, (f: string) => f],
            ['relative file', (f: string) => `./${path.basename(f)}`, (f: string) => f],
            ['no extension', (f: string) => f.replace(/\.ts$/, ''), (f: string) => f],
        ])('resolves %s', (_name, input, expected) => {
            const file = write('workflows.ts');
            expect(resolveWorkflowsPath(input(file), dir)).toBe(expected(file));
        });

        it('swaps .ts for .js when only the js build exists (running from dist)', () => {
            const js = write('workflows.js');
            expect(resolveWorkflowsPath(path.join(dir, 'workflows.ts'))).toBe(js);
        });

        it('swaps .js for .ts when only the source exists (running from src)', () => {
            const ts = write('workflows.ts');
            expect(resolveWorkflowsPath(path.join(dir, 'workflows.js'))).toBe(ts);
        });

        it('accepts a directory that has an index file', () => {
            write('flows/index.ts');
            expect(resolveWorkflowsPath('./flows', dir)).toBe(path.join(dir, 'flows'));
        });

        it('rejects a directory without an index file', () => {
            write('flows/other.ts');
            expect(() => resolveWorkflowsPath('./flows', dir)).toThrow(/was not found/);
        });

        it('throws a clear error for a missing path', () => {
            expect(() => resolveWorkflowsPath('./nope', dir)).toThrow(
                /workflowsPath ".\/nope" was not found.*Check the path/s,
            );
        });

        it.each(['1234', '[object Object]'])('rejects bundler module id %p', (id) => {
            expect(() => resolveWorkflowsPath(id)).toThrow(/bundler module id/);
        });

        it.each(['', '   '])('rejects empty %p', (v) => {
            expect(() => resolveWorkflowsPath(v)).toThrow(/non-empty/);
        });

        it('leaves bare package specifiers to the SDK', () => {
            expect(resolveWorkflowsPath('@acme/workflows')).toBe('@acme/workflows');
        });

        it('tryResolve reports instead of throwing', () => {
            expect(tryResolveWorkflowsPath('./nope', dir).error).toBeInstanceOf(Error);
            expect(tryResolveWorkflowsPath('@acme/workflows').path).toBe('@acme/workflows');
        });
    });

    describe('validateAutoBundle', () => {
        it('ignores configs without autoBundle', () => {
            expect(() => validateAutoBundle({ workflowBundle: {} }, 'worker')).not.toThrow();
            expect(() => validateAutoBundle(undefined, 'worker')).not.toThrow();
        });
        it('requires workflowsPath', () => {
            expect(() => validateAutoBundle({ autoBundle: true }, 'worker')).toThrow(
                'worker: autoBundle requires workflowsPath',
            );
        });
        it('cannot combine with workflowBundle', () => {
            expect(() =>
                validateAutoBundle(
                    { autoBundle: true, workflowsPath: 'x', workflowBundle: {} },
                    'worker',
                ),
            ).toThrow('autoBundle cannot be combined with workflowBundle');
        });
    });

    describe('computeWorkflowBundleHash', () => {
        it('is stable for identical content and changes when a file is edited', () => {
            const entry = write('wf/index.ts', 'export const a = 1;');
            write('wf/nested/b.ts', 'export const b = 1;');
            const first = computeWorkflowBundleHash(entry);
            expect(computeWorkflowBundleHash(entry)).toBe(first);

            write('wf/nested/b.ts', 'export const b = 2;');
            expect(computeWorkflowBundleHash(entry)).not.toBe(first);
        });

        it('changes with bundler options (including function options)', () => {
            const entry = write('wf/index.ts', 'x');
            const base = computeWorkflowBundleHash(entry);
            const a = computeWorkflowBundleHash(entry, {
                bundlerOptions: { webpackConfigHook: (c) => c },
            });
            const b = computeWorkflowBundleHash(entry, {
                bundlerOptions: { webpackConfigHook: (c) => ({ ...c }) },
            });
            expect(new Set([base, a, b]).size).toBe(3);
        });

        it('includes hashPaths and ignores node_modules, maps and d.ts', () => {
            const entry = write('wf/index.ts', 'x');
            const shared = write('shared/util.ts', '1');
            const base = computeWorkflowBundleHash(entry);
            const withShared = computeWorkflowBundleHash(entry, {
                hashPaths: [path.dirname(shared)],
            });
            expect(withShared).not.toBe(base);

            write('wf/node_modules/pkg/index.js', 'noise');
            write('wf/index.js.map', 'noise');
            write('wf/types.d.ts', 'noise');
            expect(computeWorkflowBundleHash(entry)).toBe(base);

            write('shared/util.ts', '2');
            expect(
                computeWorkflowBundleHash(entry, { hashPaths: [path.dirname(shared)] }),
            ).not.toBe(withShared);
        });

        it('copes with a bare specifier that is not on disk', () => {
            expect(() => computeWorkflowBundleHash('@acme/workflows')).not.toThrow();
        });
    });

    describe('buildWorkflowBundle', () => {
        it('bundles on a miss, then serves the cache on a hit', async () => {
            const entry = write('wf/index.ts', 'export {}');
            const cacheDir = path.join(dir, 'cache');

            const first = await buildWorkflowBundle(entry, { cacheDir });
            expect(first).toMatchObject({ code: 'BUNDLED', cached: false });
            expect(bundleWorkflowCode).toHaveBeenCalledTimes(1);
            expect(bundleWorkflowCode).toHaveBeenCalledWith({ workflowsPath: entry });
            expect(fs.existsSync(path.join(cacheDir, `${first.hash}.js`))).toBe(true);

            const second = await buildWorkflowBundle(entry, { cacheDir });
            expect(second).toMatchObject({ code: 'BUNDLED', cached: true, hash: first.hash });
            expect(bundleWorkflowCode).toHaveBeenCalledTimes(1);
        });

        it('rebuilds when the source changes', async () => {
            const entry = write('wf/index.ts', 'v1');
            const cacheDir = path.join(dir, 'cache');
            const first = await buildWorkflowBundle(entry, { cacheDir });
            write('wf/index.ts', 'v2');
            const second = await buildWorkflowBundle(entry, { cacheDir });
            expect(second.cached).toBe(false);
            expect(second.hash).not.toBe(first.hash);
            expect(bundleWorkflowCode).toHaveBeenCalledTimes(2);
        });

        it('rebuilds when the cached file is empty (torn write)', async () => {
            const entry = write('wf/index.ts', 'v1');
            const cacheDir = path.join(dir, 'cache');
            const first = await buildWorkflowBundle(entry, { cacheDir });
            fs.writeFileSync(path.join(cacheDir, `${first.hash}.js`), '');
            const again = await buildWorkflowBundle(entry, { cacheDir });
            expect(again.cached).toBe(false);
            expect(fs.readFileSync(path.join(cacheDir, `${first.hash}.js`), 'utf8')).toBe(
                'BUNDLED',
            );
        });

        it('cache: false always bundles and writes nothing', async () => {
            const entry = write('wf/index.ts', 'v1');
            const cacheDir = path.join(dir, 'cache');
            await buildWorkflowBundle(entry, { cacheDir, cache: false });
            await buildWorkflowBundle(entry, { cacheDir, cache: false });
            expect(bundleWorkflowCode).toHaveBeenCalledTimes(2);
            expect(fs.existsSync(cacheDir)).toBe(false);
        });

        it('forwards bundlerOptions and propagates bundler errors', async () => {
            const entry = write('wf/index.ts', 'v1');
            const hook = (c: unknown) => c;
            bundleWorkflowCode.mockRejectedValueOnce(new Error('webpack failed'));
            await expect(
                buildWorkflowBundle(entry, {
                    cacheDir: path.join(dir, 'c'),
                    bundlerOptions: { webpackConfigHook: hook as never },
                }),
            ).rejects.toThrow('webpack failed');
            expect(bundleWorkflowCode).toHaveBeenCalledWith({
                webpackConfigHook: hook,
                workflowsPath: entry,
            });
        });

        it('uses the OS temp dir by default', async () => {
            const entry = write('wf/index.ts', 'default-cache');
            const result = await buildWorkflowBundle(entry);
            const file = path.join(
                os.tmpdir(),
                'nestjs-temporal-core-bundles',
                `${result.hash}.js`,
            );
            expect(fs.existsSync(file)).toBe(true);
            fs.rmSync(file);
        });
    });
});
