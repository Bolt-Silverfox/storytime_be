/**
 * Utility for consistent error message extraction across the codebase.
 * Replaces repeated `error instanceof Error ? error.message : ...` patterns.
 */
export class ErrorHandler {
  static extractMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  static extractStack(error: unknown): string | undefined {
    return error instanceof Error ? error.stack : undefined;
  }
}
