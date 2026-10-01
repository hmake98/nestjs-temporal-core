#!/usr/bin/env node
/**
 * Consumer smoke test: packs the library, installs the tarball into a throwaway
 * project and checks it the way an end user would consume it.
 *
 *  1. Main entry loads with the optional peers (@nestjs/testing, @temporalio/testing)
 *     NOT installed, and never touches them.
 *  2. After installing the optional peers, the `/testing` subpath loads, works, and
 *     type-checks under classic `node10` module resolution.
 *  3. Deep `dist/...` imports still resolve (no `exports` map in 3.x).
 *
 * Requires a prior `npm run build`. Run: `npm run test:smoke`.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ntc-smoke-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const run = (cmd, args, cwd) =>
    execFileSync(cmd, args, { cwd, stdio: 'inherit', env: { ...process.env, CI: '1' } });
const step = (msg) => console.log(`\n=== ${msg}`);
const dev = (name) => pkg.devDependencies[name];

try {
    step('npm pack');
    const packOut = execFileSync(npm, ['pack', '--pack-destination', tmp, '--json'], {
        cwd: root,
        encoding: 'utf8',
    });
    const tarball = path.join(tmp, JSON.parse(packOut)[0].filename);

    const app = path.join(tmp, 'app');
    fs.mkdirSync(app);
    fs.writeFileSync(
        path.join(app, 'package.json'),
        JSON.stringify({ name: 'consumer-smoke', private: true, version: '1.0.0' }),
    );

    step('install tarball + required peers only');
    run(
        npm,
        [
            'install',
            '--no-audit',
            '--no-fund',
            tarball,
            `@nestjs/common@${dev('@nestjs/common')}`,
            `@nestjs/core@${dev('@nestjs/core')}`,
            `@temporalio/client@${dev('@temporalio/client')}`,
            `@temporalio/common@${dev('@temporalio/common')}`,
            `@temporalio/worker@${dev('@temporalio/worker')}`,
            `@temporalio/workflow@${dev('@temporalio/workflow')}`,
            'reflect-metadata@^0.2.2',
            'rxjs@^7.8.0',
            `typescript@${dev('typescript')}`,
            '--legacy-peer-deps',
        ],
        app,
    );

    step('main entry loads without optional peers');
    fs.writeFileSync(
        path.join(app, 'main-entry.js'),
        `
const Module = require('module');
const loaded = [];
const orig = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  loaded.push(request);
  return orig.call(this, request, ...rest);
};
const lib = require('nestjs-temporal-core');
const leaked = loaded.filter((r) => r === '@temporalio/testing' || r === '@nestjs/testing');
if (leaked.length) throw new Error('main entry loaded optional peers: ' + leaked);
for (const name of ['TemporalModule', 'TemporalService', 'TemporalClientError']) {
  if (!lib[name]) throw new Error('missing export ' + name);
}
require('nestjs-temporal-core/dist/errors');
console.log('main entry ok, deep import ok');
`,
    );
    run(process.execPath, ['main-entry.js'], app);

    step('install optional peers');
    run(
        npm,
        [
            'install',
            '--no-audit',
            '--no-fund',
            '--legacy-peer-deps',
            `@nestjs/testing@${dev('@nestjs/testing')}`,
            `@temporalio/testing@${dev('@temporalio/testing')}`,
        ],
        app,
    );

    step('/testing subpath works at runtime');
    fs.writeFileSync(
        path.join(app, 'testing-entry.js'),
        `
require('reflect-metadata');
const { Test } = require('@nestjs/testing');
const { TemporalService } = require('nestjs-temporal-core');
const { TemporalTestingModule, TemporalTestingRecorder } = require('nestjs-temporal-core/testing');
(async () => {
  const ref = await Test.createTestingModule({ imports: [TemporalTestingModule.register()] }).compile();
  const res = await ref.get(TemporalService).startWorkflow('wf', [], { workflowId: 'w1' });
  if (!res.success) throw new Error('fake startWorkflow failed');
  if (ref.get(TemporalTestingRecorder).callsTo('startWorkflow').length !== 1) throw new Error('call not recorded');
  console.log('/testing ok');
})().catch((e) => { console.error(e); process.exit(1); });
`,
    );
    run(process.execPath, ['testing-entry.js'], app);

    step('/testing subpath type-checks (moduleResolution node10)');
    fs.writeFileSync(
        path.join(app, 'types.ts'),
        `
import { TemporalTestingModule, createActivityHarness } from 'nestjs-temporal-core/testing';
import { TemporalService } from 'nestjs-temporal-core';
export const probe = [TemporalTestingModule, createActivityHarness, TemporalService];
`,
    );
    fs.writeFileSync(
        path.join(app, 'tsconfig.json'),
        JSON.stringify({
            compilerOptions: {
                target: 'ES2020',
                module: 'commonjs',
                moduleResolution: 'node10',
                strict: true,
                skipLibCheck: true,
                noEmit: true,
                esModuleInterop: true,
                experimentalDecorators: true,
                emitDecoratorMetadata: true,
            },
            files: ['types.ts'],
        }),
    );
    run(process.execPath, [path.join(app, 'node_modules/typescript/bin/tsc'), '-p', '.'], app);

    console.log('\nconsumer smoke test passed');
} finally {
    fs.rmSync(tmp, { recursive: true, force: true });
}
