module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  // The time-skipping test downloads a test-server binary on first run.
  testTimeout: 90000,
};
