import * as bcrypt from 'bcrypt';
import { BadRequestException } from '@nestjs/common';

const SALT_ROUNDS = 12;

/**
 * Hash a 6-digit PIN
 */
export async function hashPin(pin: string): Promise<string> {
  if (!/^\d{6}$/.test(pin)) {
    throw new BadRequestException('PIN must be exactly 6 digits');
  }
  return bcrypt.hash(pin, SALT_ROUNDS);
}

/**
 * Compare PIN with hashed version
 */
export async function verifyPinHash(
  pin: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(pin, hash);
}
