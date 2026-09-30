// Integration tests run against a real Temporal dev server started by
// @temporalio/testing (binary downloaded on first run, cached afterwards).
// Kept separate from the root config so `npm test` stays fast and offline,
// and so the unit-test coverage gate is not diluted by these suites.
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    rootDir: '../..',
    roots: ['<rootDir>/test/integration'],
    testMatch: ['**/*.spec.ts'],
    transform: {
        '^.+\\.ts$': [
            'ts-jest',
            {
                tsconfig: {
                    experimentalDecorators: true,
                    emitDecoratorMetadata: true,
                },
                isolatedModules: true,
            },
        ],
    },
    setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
    moduleFileExtensions: ['ts', 'js', 'json'],
    // Dev server download + workflow bundling on a cold cache.
    testTimeout: 60000,
};
