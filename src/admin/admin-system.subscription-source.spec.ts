import { Test, TestingModule } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import 'reflect-metadata';
import { AdminSystemService } from './admin-system.service';
import { ADMIN_SYSTEM_REPOSITORY } from './repositories/admin-system.repository.interface';
import { ADMIN_CONTENT_REPOSITORY } from './repositories';
import { ElevenLabsTTSProvider } from '../voice/providers/eleven-labs-tts.provider';
import { PrismaService } from '../prisma/prisma.service';
import { PrismaAdminSystemRepository } from './repositories/prisma-admin-system.repository';
import { SubscriptionDto } from './dto/admin-responses.dto';
import { ValidationException } from '@/shared/exceptions';

describe('GET /admin/subscriptions source filter (service)', () => {
  let service: AdminSystemService;
  const findSubscriptions = jest.fn().mockResolvedValue([]);

  beforeEach(async () => {
    findSubscriptions.mockClear();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminSystemService,
        { provide: ADMIN_SYSTEM_REPOSITORY, useValue: { findSubscriptions } },
        { provide: ElevenLabsTTSProvider, useValue: {} },
        { provide: ADMIN_CONTENT_REPOSITORY, useValue: {} },
        { provide: PrismaService, useValue: {} },
        { provide: CACHE_MANAGER, useValue: {} },
      ],
    }).compile();
    service = module.get(AdminSystemService);
  });

  it('filters by source and combines with status', async () => {
    await service.getSubscriptions('active', 'admin_grant');
    expect(findSubscriptions).toHaveBeenCalledWith({
      where: { isDeleted: false, status: 'active', source: 'admin_grant' },
      orderBy: { startedAt: 'desc' },
    });
  });

  it('rejects an unknown source value', async () => {
    await expect(service.getSubscriptions(undefined, 'gifted')).rejects.toThrow(
      ValidationException,
    );
    expect(findSubscriptions).not.toHaveBeenCalled();
  });
});

describe('PrismaAdminSystemRepository.findSubscriptions DTO mapping', () => {
  const row = (over: Record<string, unknown>) => ({
    id: 's',
    plan: 'yearly',
    status: 'active',
    startedAt: new Date('2026-10-01'),
    endsAt: new Date('2027-10-01'),
    isDeleted: false,
    deletedAt: null,
    user: { id: 'u', email: 'a@b.c', name: 'A' },
    source: 'store',
    grantedByAdminId: null,
    grantReason: null,
    ...over,
  });

  it('exposes source, grant fields, admin name and isComplimentary', async () => {
    const prisma = {
      subscription: {
        findMany: jest.fn().mockResolvedValue([
          row({
            id: 'g',
            source: 'admin_grant',
            grantedByAdminId: 'adm',
            grantReason: 'press',
          }),
          row({ id: 'p' }),
        ]),
      },
      user: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'adm', name: 'Ada Admin' }]),
      },
    };
    const repo = new PrismaAdminSystemRepository(prisma as never);

    const [granted, paying] = await repo.findSubscriptions({});

    expect(granted).toMatchObject({
      source: 'admin_grant',
      grantedByAdminId: 'adm',
      grantedByAdminName: 'Ada Admin',
      grantReason: 'press',
      isComplimentary: true,
    });
    expect(paying).toMatchObject({
      source: 'store',
      grantedByAdminId: null,
      grantedByAdminName: null,
      grantReason: null,
      isComplimentary: false,
    });
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['adm'] } },
      select: { id: true, name: true },
    });
  });

  it('documents the new fields in the Swagger model', () => {
    const props: string[] =
      Reflect.getMetadata(
        'swagger/apiModelPropertiesArray',
        SubscriptionDto.prototype,
      ) ?? [];
    for (const f of [
      ':source',
      ':grantedByAdminId',
      ':grantedByAdminName',
      ':grantReason',
      ':isComplimentary',
    ]) {
      expect(props).toContain(f);
    }
  });
});
