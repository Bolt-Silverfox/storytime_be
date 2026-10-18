// jest.config.js
module.exports = {
    moduleFileExtensions: ['js', 'json', 'ts', 'tsx'],
    rootDir: '.',
    testRegex: '.*\\.(spec|e2e-spec)\\.ts$',
    transform: {
      '^.+\\.(t|j)sx?$': 'ts-jest',
    },
    collectCoverageFrom: ['**/*.(t|j)s'],
    coverageDirectory: './coverage',
    testEnvironment: 'node',
    // @nestjs/jwt 12, @nestjs/event-emitter 12 and @nestjs/schedule 12 ship
    // ESM only (no `require` condition, no CJS build). Jest's CJS runtime
    // cannot require them, so they must be transformed rather than passed
    // through untouched.
    transformIgnorePatterns: [
      '/node_modules/\\.pnpm/(?!@nestjs\\+(jwt|event-emitter|schedule)@)',
    ],
    // Use V8 coverage rather than babel-plugin-istanbul. Istanbul pulls
    // test-exclude@6, which calls minimatch's callable default export; the
    // pnpm.overrides floor of minimatch >=9.0.6 forces v10, where that export
    // no longer exists, so every suite dies with "minimatch is not a function"
    // under --coverage. V8 coverage does not go through test-exclude at all,
    // so this fixes it without lowering the minimatch floor.
    coverageProvider: 'v8',
    moduleNameMapper: {
      '^@/(.*)$': '<rootDir>/src/$1',
      '^src/(.*)$': '<rootDir>/src/$1',
      '^googleapis$': '<rootDir>/__mocks__/googleapis.ts',
      '^@andresaya/edge-tts$': '<rootDir>/__mocks__/@andresaya/edge-tts.ts',
    },
  };