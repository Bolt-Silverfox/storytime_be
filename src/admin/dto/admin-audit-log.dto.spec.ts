import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { AdminAuditLogFilterDto } from './admin-audit-log.dto';

describe('AdminAuditLogFilterDto', () => {
  it('accepts a limit within bounds', async () => {
    const dto = plainToInstance(AdminAuditLogFilterDto, { limit: 50 });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects a limit above the 100 cap', async () => {
    const dto = plainToInstance(AdminAuditLogFilterDto, { limit: 1000000 });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'limit')).toBe(true);
  });

  it('rejects a limit below 1', async () => {
    const dto = plainToInstance(AdminAuditLogFilterDto, { limit: 0 });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'limit')).toBe(true);
  });
});
