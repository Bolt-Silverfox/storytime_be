export class TakeoverTargetChangedError extends Error {
  constructor() {
    super('Account no longer holds the proven email');
  }
}
