import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { AutoBundleOptions } from '../interfaces';

export interface WorkflowBundleResult {
    /** The bundled workflow code, ready for `workflowBundle: { code }`. */
    code: string;
    /** Content hash that keys the cache entry. */
    hash: string;
    /** True when the code came from the cache and no bundling ran. */
    cached: boolean;
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'coverage', 'dist-cache']);
const SKIP_FILES = /\.(d\.ts|map|tsbuildinfo)$/;

/** Every file under `target` (a file, or a directory walked recursively), sorted. */
function listFiles(target: string): string[] {
    let stat: fs.Stats;
    try {
        stat = fs.statSync(target);
    } catch {
        return [];
    }
    if (stat.isFile()) return [target];
    const out: string[] = [];
    for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (!SKIP_DIRS.has(entry.name)) out.push(...listFiles(path.join(target, entry.name)));
        } else if (entry.isFile() && !SKIP_FILES.test(entry.name)) {
            out.push(path.join(target, entry.name));
        }
    }
    return out.sort();
}

function sdkVersion(): string {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        return (require('@temporalio/worker/package.json') as { version: string }).version;
    } catch {
        return 'unknown';
    }
}

/**
 * Cache key: workflow source (the directory of `workflowsPath`, or the file's directory) plus
 * `hashPaths`, the SDK version and the bundler options. Editing any file changes the key.
 */
export function computeWorkflowBundleHash(
    workflowsPath: string,
    options: AutoBundleOptions = {},
): string {
    const hash = createHash('sha256');
    hash.update(`sdk:${sdkVersion()}\n`);
    hash.update(`path:${path.resolve(workflowsPath)}\n`);
    hash.update(
        `opts:${JSON.stringify(options.bundlerOptions ?? {}, (_k, v) =>
            typeof v === 'function' ? v.toString() : v,
        )}\n`,
    );

    let root = path.resolve(workflowsPath);
    try {
        if (fs.statSync(root).isFile()) root = path.dirname(root);
    } catch {
        // Bare specifier or missing path: hash only the identifiers above.
        root = '';
    }
    const targets = [
        ...(root ? [root] : []),
        ...(options.hashPaths ?? []).map((p) => path.resolve(p)),
    ];
    for (const target of targets) {
        for (const file of listFiles(target)) {
            hash.update(`file:${path.relative(target, file)}\n`);
            hash.update(fs.readFileSync(file));
        }
    }
    return hash.digest('hex');
}

/**
 * Bundle workflows once per distinct source. With the cache on (default) an unchanged source
 * reuses `<cacheDir>/<hash>.js` and skips the slow webpack step on every restart.
 */
export async function buildWorkflowBundle(
    workflowsPath: string,
    options: AutoBundleOptions = {},
): Promise<WorkflowBundleResult> {
    const useCache = options.cache !== false;
    const cacheDir = options.cacheDir ?? path.join(os.tmpdir(), 'nestjs-temporal-core-bundles');
    const hash = computeWorkflowBundleHash(workflowsPath, options);
    const cacheFile = path.join(cacheDir, `${hash}.js`);

    if (useCache && fs.existsSync(cacheFile)) {
        const code = fs.readFileSync(cacheFile, 'utf8');
        // An empty file is a torn write, not a bundle: rebuild instead of failing the worker.
        if (code.length > 0) return { code, hash, cached: true };
    }

    const { bundleWorkflowCode } = await import('@temporalio/worker');
    const { code } = await bundleWorkflowCode({
        ...options.bundlerOptions,
        workflowsPath,
    });

    if (useCache) {
        fs.mkdirSync(cacheDir, { recursive: true });
        // Write then rename: a concurrent reader never sees a half-written bundle.
        const tmp = `${cacheFile}.${process.pid}.${Date.now()}.tmp`;
        fs.writeFileSync(tmp, code);
        fs.renameSync(tmp, cacheFile);
    }
    return { code, hash, cached: false };
}
