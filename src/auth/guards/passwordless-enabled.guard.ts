import { CanActivate, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class PasswordlessEnabledGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(): boolean {
    const flag = this.configService.get<boolean | string>(
      'PASSWORDLESS_LOGIN_ENABLED',
    );
    if (flag === true || flag === 'true') return true;
    throw new NotFoundException();
  }
}
