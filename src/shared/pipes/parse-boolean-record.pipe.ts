import { PipeTransform, Injectable, BadRequestException } from '@nestjs/common';

/**
 * Validates that the input is a plain object with all values being booleans.
 * Used for endpoints that accept `Record<string, boolean>` bodies
 * (e.g., notification preference updates).
 *
 * @example
 * @Body(ParseBooleanRecordPipe) preferences: Record<string, boolean>
 */
@Injectable()
export class ParseBooleanRecordPipe
  implements PipeTransform<unknown, Record<string, boolean>>
{
  transform(value: unknown): Record<string, boolean> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new BadRequestException(
        'Body must be a JSON object of category-boolean pairs',
      );
    }

    const record = value as Record<string, unknown>;

    if (Object.keys(record).length === 0) {
      throw new BadRequestException(
        'Body must contain at least one preference',
      );
    }

    for (const [key, val] of Object.entries(record)) {
      if (typeof val !== 'boolean') {
        throw new BadRequestException(
          `Invalid value for "${key}": expected boolean, got ${typeof val}`,
        );
      }
    }

    return record as Record<string, boolean>;
  }
}
