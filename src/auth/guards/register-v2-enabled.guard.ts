import { CanActivate, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class RegisterV2EnabledGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(): boolean {
    const flag = this.configService.get<boolean | string>(
      'REGISTER_V2_ENABLED',
      true,
    );
    if (flag === false || flag === 'false' || flag === '0') {
      throw new NotFoundException();
    }
    return true;
  }
}
