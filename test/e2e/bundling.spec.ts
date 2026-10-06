/**
 * E2E: the only way to verify bundling. Compiles a real Nest app with tsc into plain JS, boots
 * it as a separate process from the compiled output, and runs a workflow through its worker.
 * Covers the dev-vs-dist path swap (no extension, `.js` on disk) and the autoBundle cache.
 */
import { ChildProcess, execFileSync, spawn } from 'child_process';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const root = path.resolve(__dirname, '../..');
const buildDir = path.join(__dirname, '.build');
const entry = path.join(buildDir, 'test/e2e/fixture/main.js');

function bootApp(env: Record<string, string>): Promise<ChildProcess> {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [entry], {
            cwd: root,
            env: { ...process.env, ...env },
        });
        let output = '';
        const timer = setTimeout(
            () => reject(new Error(`app did not become ready:\n${output}`)),
            90_000,
        );
        const onData = (chunk: Buffer) => {
            output += chunk.toString();
            if (output.includes('E2E_READY')) {
                clearTimeout(timer);
                resolve(child);
            }
        };
        child.stdout.on('data', onData);
        child.stderr.on('data', (c) => (output += c.toString()));
        child.on('exit', (code) => {
            clearTimeout(timer);
            reject(new Error(`app exited early (${code}):\n${output}`));
        });
    });
}

describe('e2e: compiled Nest app with autoBundle', () => {
    let env: TestWorkflowEnvironment;
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ntc-e2e-'));
    const children: ChildProcess[] = [];

    beforeAll(async () => {
        fs.rmSync(buildDir, { recursive: true, force: true });
        execFileSync('npx', ['tsc', '-p', path.join(__dirname, 'tsconfig.json')], {
            cwd: root,
            stdio: 'inherit',
        });
        // The point of the test: only compiled JS exists, no .ts for the workflows path.
        expect(fs.existsSync(path.join(buildDir, 'test/e2e/fixture/workflows.js'))).toBe(true);
        const downloadDir = process.env.TEMPORAL_DEV_SERVER_DIR;
        if (downloadDir) fs.mkdirSync(downloadDir, { recursive: true });
        env = await TestWorkflowEnvironment.createLocal(
            downloadDir ? { server: { executable: { type: 'cached-download', downloadDir } } } : {},
        );
    }, 180_000);

    afterAll(async () => {
        children.forEach((c) => c.removeAllListeners('exit'));
        children.forEach((c) => c.kill('SIGTERM'));
        await env?.teardown();
        fs.rmSync(cacheDir, { recursive: true, force: true });
        fs.rmSync(buildDir, { recursive: true, force: true });
    });

    const run = async (taskQueue: string) => {
        const child = await bootApp({
            E2E_TEMPORAL_ADDRESS: env.address,
            E2E_TASK_QUEUE: taskQueue,
            E2E_CACHE_DIR: cacheDir,
        });
        children.push(child);
        return env.client.workflow.execute('e2eWorkflow', {
            taskQueue,
            workflowId: `e2e-${randomUUID()}`,
            args: ['dist'],
        });
    };

    it('runs a workflow from compiled output, then reuses the bundle cache on restart', async () => {
        await expect(run(`e2e-${randomUUID()}`)).resolves.toBe('HELLO DIST');
        const cached = fs.readdirSync(cacheDir);
        expect(cached).toHaveLength(1);

        const mtime = fs.statSync(path.join(cacheDir, cached[0])).mtimeMs;
        children.pop()?.kill('SIGTERM');

        await expect(run(`e2e-${randomUUID()}`)).resolves.toBe('HELLO DIST');
        expect(fs.readdirSync(cacheDir)).toEqual(cached);
        expect(fs.statSync(path.join(cacheDir, cached[0])).mtimeMs).toBe(mtime);
    }, 180_000);
});
