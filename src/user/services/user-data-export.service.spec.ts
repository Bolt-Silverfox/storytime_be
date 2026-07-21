import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import {
  UserDataExportService,
  USER_DATA_EXPORT_FORMAT,
} from './user-data-export.service';
import { USER_REPOSITORY } from '../repositories/user.repository.interface';

describe('UserDataExportService', () => {
  let service: UserDataExportService;
  const findUserForExport = jest.fn();

  beforeEach(async () => {
    findUserForExport.mockReset();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserDataExportService,
        { provide: USER_REPOSITORY, useValue: { findUserForExport } },
      ],
    }).compile();
    service = module.get(UserDataExportService);
  });

  const EXPORTED_AT = '2026-07-21T00:00:00.000Z';

  it('throws NotFoundException when the user does not exist', async () => {
    findUserForExport.mockResolvedValue(null);
    await expect(service.exportUserData('missing', EXPORTED_AT)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('strips passwordHash and pinHash from the export', async () => {
    findUserForExport.mockResolvedValue({
      id: 'u1',
      email: 'p@example.com',
      passwordHash: 'SECRET_HASH',
      pinHash: 'SECRET_PIN',
      name: 'Parent',
      kids: [{ id: 'k1', name: 'Kid', createdStories: [] }],
      profile: { country: 'NG' },
    });

    const result = await service.exportUserData('u1', EXPORTED_AT);
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain('SECRET_HASH');
    expect(serialized).not.toContain('SECRET_PIN');
    expect(result.account).not.toHaveProperty('passwordHash');
    expect(result.account).not.toHaveProperty('pinHash');
  });

  it('produces a self-describing envelope with the user id and format', async () => {
    findUserForExport.mockResolvedValue({
      id: 'u1',
      email: 'p@example.com',
      passwordHash: 'x',
      pinHash: null,
      kids: [],
    });

    const result = await service.exportUserData('u1', EXPORTED_AT);

    expect(result.meta).toEqual({
      format: USER_DATA_EXPORT_FORMAT,
      exportedAt: EXPORTED_AT,
      userId: 'u1',
    });
    // account keeps non-secret scalars and separates relations to the top level.
    expect(result.account).toMatchObject({ id: 'u1', email: 'p@example.com' });
    expect(result.kids).toEqual([]);
  });
});
