module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>/src', '<rootDir>/test'],
    testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
    transform: {
        '^.+\\.ts$': [
            'ts-jest',
            {
                tsconfig: {
                    experimentalDecorators: true,
                    emitDecoratorMetadata: true,
                },
                isolatedModules: true,
                useESM: false,
            },
        ],
    },
    collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts', '!src/index.ts', '!src/interfaces.ts'],
    coverageDirectory: 'coverage',
    coverageReporters: ['text', 'lcov', 'html', 'json-summary'],
    // Emit JUnit XML alongside the normal console output so Codecov Test
    // Analytics can ingest per-test results (durations, failures, flakes).
    // The `default` reporter keeps the usual terminal output intact.
    reporters: [
        'default',
        [
            'jest-junit',
            {
                outputDirectory: '.',
                outputName: 'junit.xml',
                ancestorSeparator: ' › ',
                uniqueOutputName: 'false',
                suiteNameTemplate: '{filepath}',
                classNameTemplate: '{classname}',
                titleTemplate: '{title}',
            },
        ],
    ],
    coverageThreshold: {
        global: {
            branches: 90,
            functions: 90,
            lines: 90,
            statements: 90,
        },
    },
    moduleFileExtensions: ['ts', 'js', 'json'],
    setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
    testTimeout: 5000,
    moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
    },
};
