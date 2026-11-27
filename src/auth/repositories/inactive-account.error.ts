export class InactiveAccountError extends Error {
  constructor() {
    super('Account is suspended or deleted');
  }
}
