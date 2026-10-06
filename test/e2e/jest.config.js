// E2E: compiles a real Nest app and boots it from compiled output. Slower than integration
// (a tsc build plus a child process), so it runs on PRs that touch bundling and nightly.
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    rootDir: '../..',
    roots: ['<rootDir>/test/e2e'],
    testMatch: ['**/*.spec.ts'],
    testPathIgnorePatterns: ['/node_modules/', '/.build/'],
    transform: {
        '^.+\\.ts$': [
            'ts-jest',
            {
                tsconfig: { experimentalDecorators: true, emitDecoratorMetadata: true },
                isolatedModules: true,
            },
        ],
    },
    moduleFileExtensions: ['ts', 'js', 'json'],
    testTimeout: 180000,
};
