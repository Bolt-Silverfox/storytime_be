// jest.config.js
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts', 'tsx'],
  rootDir: '.',
  testRegex: '.*\\.(spec|e2e-spec)\\.ts$',
  transform: {
    // @nestjs/terminus 12 is ESM-only and uses `import.meta`, which ts-jest
    // cannot compile to CommonJS. Compile it with SWC instead. This entry
    // must stay before the catch-all ts-jest entry (first match wins).
    '/node_modules/\\.pnpm/@nestjs\\+terminus@.*\\.js$':
      '<rootDir>/test/esm-to-cjs.transform.js',
    // sanitize-html >= 2.17.7 pulls in the ESM-only htmlparser2 12 stack.
    '/node_modules/\\.pnpm/(htmlparser2@12|entities@8|domhandler@6|domutils@4|domelementtype@3|dom-serializer@3)\\.[^/]*/.*\\.js$':
      '<rootDir>/test/esm-to-cjs.transform.js',
    '^.+\\.(t|j)sx?$': 'ts-jest',
  },
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: './coverage',
  testEnvironment: 'node',
  // @nestjs/jwt 12, @nestjs/event-emitter 12, @nestjs/schedule 12,
  // @nestjs/passport 12 and @nestjs/cache-manager 12 ship
  // ESM only (no CJS build). Their `exports` map has a `require` condition,
  // but it points at the same ESM file, which plain Node 24 can load through
  // require(esm). Jest's CJS runtime cannot, so they must be transformed
  // rather than passed through untouched.
  transformIgnorePatterns: [
    '/node_modules/\\.pnpm/(?!@nestjs\\+(jwt|event-emitter|schedule|terminus|passport|cache-manager)@|(htmlparser2@12|entities@8|domhandler@6|domutils@4|domelementtype@3|dom-serializer@3)\\.)',
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
    '^load-esm$': '<rootDir>/__mocks__/load-esm.ts',
    '^@andresaya/edge-tts$': '<rootDir>/__mocks__/@andresaya/edge-tts.ts',
  },
};
