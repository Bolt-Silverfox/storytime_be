// Jest transformer for ESM-only dependencies that use `import.meta`
// (currently @nestjs/terminus 12). ts-jest cannot be used for these files:
// it does not compile .js sources (allowJs is off) and TypeScript's CommonJS
// emit leaves `import.meta` untouched, which is a SyntaxError under CJS.
// SWC rewrites `import.meta.url` to a CJS equivalent, so the real library
// code runs in the unit tests instead of a hand-written double.
const swc = require('@swc/core');

module.exports = {
  process(sourceText, sourcePath) {
    const { code, map } = swc.transformSync(sourceText, {
      filename: sourcePath,
      sourceMaps: 'inline',
      swcrc: false,
      configFile: false,
      module: { type: 'commonjs' },
      jsc: { target: 'es2022', parser: { syntax: 'ecmascript' } },
    });
    return { code, map };
  },
};
