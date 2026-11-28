export class AccountAlreadyVerifiedError extends Error {
  constructor() {
    super('Account is already verified');
  }
}
