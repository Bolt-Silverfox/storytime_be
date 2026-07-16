export class GuestActivityEvent {
  constructor(
    public readonly action: string,
    public readonly details: string,
    public readonly status: string = 'SUCCESS',
  ) {}
}
