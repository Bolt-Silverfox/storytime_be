const CREDENTIAL_KEYS = new Set(['passwordHash', 'pinHash']);

export type WithoutCredentials<T> = T extends Date
  ? T
  : T extends readonly (infer U)[]
    ? WithoutCredentials<U>[]
    : T extends object
      ? {
          [
            K in Exclude<keyof T, 'passwordHash' | 'pinHash'>
          ]: WithoutCredentials<T[K]>;
        }
      : T;

export function stripCredentials<T>(value: T): WithoutCredentials<T> {
  if (Array.isArray(value)) {
    return value.map((item) => stripCredentials(item)) as WithoutCredentials<T>;
  }
  if (
    value !== null &&
    typeof value === 'object' &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      if (!CREDENTIAL_KEYS.has(key)) out[key] = stripCredentials(inner);
    }
    return out as WithoutCredentials<T>;
  }
  return value as WithoutCredentials<T>;
}
