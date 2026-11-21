import { BadRequestException, PipeTransform } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PASSWORDLESS_INVALID_MESSAGE } from '../services/passwordless.constants';

export class PasswordlessBodyPipe<T extends object> implements PipeTransform {
  constructor(private readonly dto: new () => T) {}

  transform(value: unknown): T {
    if (typeof value !== 'object' || value === null) {
      throw new BadRequestException(PASSWORDLESS_INVALID_MESSAGE);
    }
    const instance = plainToInstance(this.dto, value);
    const errors = validateSync(instance, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    if (errors.length > 0) {
      throw new BadRequestException(PASSWORDLESS_INVALID_MESSAGE);
    }
    return instance;
  }
}
