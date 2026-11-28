import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';

function resolveFrom(fromPackage: string, target: string): string {
  const fromEntry = realpathSync(require.resolve(fromPackage));
  return realpathSync(createRequire(fromEntry).resolve(target));
}

describe('OpenTelemetry packages shared by Sentry and the NodeSDK', () => {
  it.each(['@opentelemetry/core', '@opentelemetry/api'])(
    '@sentry/opentelemetry and @opentelemetry/sdk-node load the same %s',
    (otelPackage) => {
      expect(resolveFrom('@sentry/opentelemetry', otelPackage)).toBe(
        resolveFrom('@opentelemetry/sdk-node', otelPackage),
      );
    },
  );
});
