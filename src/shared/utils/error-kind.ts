export const errorKind = (error: unknown): string =>
  error instanceof Error ? error.name : typeof error;
