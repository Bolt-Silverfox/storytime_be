export const renderLogCalls = (calls: unknown[][]): string =>
  JSON.stringify(calls, (_key, value: unknown) =>
    value instanceof Error
      ? { name: value.name, message: value.message, stack: value.stack }
      : value,
  );
