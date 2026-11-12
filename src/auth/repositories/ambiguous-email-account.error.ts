export class AmbiguousEmailAccountError extends Error {
  constructor() {
    super('Several verified accounts match this email');
  }
}
