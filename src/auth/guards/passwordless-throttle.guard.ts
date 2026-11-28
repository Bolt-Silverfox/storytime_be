import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthThrottleGuard } from '@/shared/guards/auth-throttle.guard';

@Injectable()
export class PasswordlessThrottleGuard extends AuthThrottleGuard {
  protected generateKey(
    context: ExecutionContext,
    suffix: string,
    name: string,
  ): string {
    const route = `${context.getClass().name}-${context.getHandler().name}`;
    return `${route}-${super.generateKey(context, suffix, name)}`;
  }
}
