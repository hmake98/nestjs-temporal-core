import * as fs from 'fs';
import * as path from 'path';

const EXTENSIONS = ['.ts', '.js', '.mjs', '.cjs'];
const INDEX_FILES = EXTENSIONS.map((ext) => `index${ext}`);

const isFile = (p: string): boolean => {
    try {
        return fs.statSync(p).isFile();
    } catch {
        return false;
    }
};

const isDirWithIndex = (p: string): boolean => {
    try {
        return fs.statSync(p).isDirectory() && INDEX_FILES.some((f) => isFile(path.join(p, f)));
    } catch {
        return false;
    }
};

/** Candidate locations for `base`, in lookup order (exact, extension, index, ts/js swap). */
const candidatesFor = (base: string): string[] => {
    const list = [base, ...EXTENSIONS.map((ext) => base + ext)];
    if (base.endsWith('.ts')) list.push(base.slice(0, -3) + '.js');
    else if (base.endsWith('.js')) list.push(base.slice(0, -3) + '.ts');
    return list;
};

/**
 * Resolve a `workflowsPath` to a real file or directory, so a wrong path fails at startup with
 * the fix in the message instead of deep inside the bundler.
 *
 * - Relative paths resolve against `cwd` (default `process.cwd()`).
 * - A missing extension is tried as `.ts`, `.js`, `.mjs`, `.cjs`, then as a directory `index.*`.
 * - `.ts` and `.js` are swapped when only the other exists: a path written for development
 *   (`src/workflows.ts`) still works from `dist/` and the reverse.
 * - Bare package specifiers (`@scope/workflows`) are returned untouched; the SDK bundler
 *   resolves those itself.
 * - Numeric ids (what a bundler such as webpack turns `require.resolve` into) are rejected.
 */
export function resolveWorkflowsPath(input: string, cwd: string = process.cwd()): string {
    const result = tryResolveWorkflowsPath(input, cwd);
    if (result.error) throw result.error;
    return result.path as string;
}

/**
 * Same lookup as {@link resolveWorkflowsPath}, but reports the problem instead of throwing.
 * The worker uses this for a plain `workflowsPath` so existing apps and mocked-SDK tests keep
 * today's behavior (the SDK reports its own error); `autoBundle` uses the throwing form.
 */
export function tryResolveWorkflowsPath(
    input: string,
    cwd: string = process.cwd(),
): { path?: string; error?: Error } {
    if (typeof input !== 'string' || input.trim() === '') {
        return { error: new Error('workflowsPath must be a non-empty string') };
    }
    if (/^\d+$/.test(input.trim()) || input.startsWith('[object ')) {
        return {
            error: new Error(
                `workflowsPath "${input}" looks like a bundler module id, not a file path. ` +
                    'Bundlers (webpack, esbuild) replace require.resolve() with an id. Pass a real ' +
                    'path (for example path.join(__dirname, "workflows")), or build the workflow ' +
                    'bundle ahead of time and pass it as workflowBundle: { codePath }.',
            ),
        };
    }

    const isPathLike =
        input.startsWith('.') || path.isAbsolute(input) || /^[a-zA-Z]:[\\/]/.test(input);
    if (!isPathLike) {
        return { path: input };
    }

    const base = path.resolve(cwd, input);
    for (const candidate of candidatesFor(base)) {
        if (isFile(candidate)) return { path: candidate };
    }
    if (isDirWithIndex(base)) return { path: base };

    return {
        error: new Error(
            `workflowsPath "${input}" was not found (resolved to ${base}, cwd ${cwd}). ` +
                'Tried the path as-is, with .ts/.js/.mjs/.cjs, as a directory with an index file, ' +
                'and with .ts/.js swapped. Check the path, or that the project is built when ' +
                'running from dist/.',
        ),
    };
}

/** Reject `autoBundle` combinations that cannot work. Throws; call at config time. */
export function validateAutoBundle(
    worker: { workflowsPath?: string; workflowBundle?: unknown; autoBundle?: unknown } | undefined,
    label: string,
): void {
    if (!worker?.autoBundle) return;
    if (worker.workflowBundle) {
        throw new Error(`${label}: autoBundle cannot be combined with workflowBundle`);
    }
    if (!worker.workflowsPath) {
        throw new Error(`${label}: autoBundle requires workflowsPath`);
    }
}
