// Built at runtime so the literals never appear in source context lines that
// Sentry attaches to stack frames.
export const S = Object.fromEntries(
  [
    'queryToken',
    'queryCode',
    'bodyPassword',
    'bearer',
    'cookie',
    'guest',
    'apikey',
    'errQuery',
    'outgoingToken',
  ].map((k) => [k, `sentinel-${k.toLowerCase()}-${k.length}x`]),
) as Record<string, string>;
export const SENTINELS = Object.values(S);
