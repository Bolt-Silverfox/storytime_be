import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { PrismaAdminEngagementRepository } from './prisma-admin-engagement.repository';

describe('PrismaAdminEngagementRepository.getStoryReaderStats', () => {
  let prisma: PrismaService;
  let repo: PrismaAdminEngagementRepository;
  let storyId: string;
  let kidIds: string[];
  let userIds: string[];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PrismaService, PrismaAdminEngagementRepository],
    }).compile();
    prisma = module.get(PrismaService);
    repo = module.get(PrismaAdminEngagementRepository);

    const story = await prisma.story.create({
      data: {
        title: 'Test Story',
        description: 'd',
        language: 'en',
        coverImageUrl: 'x',
        audioUrl: 'x',
        isInteractive: false,
        ageMin: 3,
        ageMax: 6,
      },
    });
    storyId = story.id;

    const parent = await prisma.user.create({
      data: { email: `parent-${Date.now()}@test.dev`, passwordHash: 'x' },
    });
    const parent2 = await prisma.user.create({
      data: { email: `parent2-${Date.now()}@test.dev`, passwordHash: 'x' },
    });
    const kid1 = await prisma.kid.create({
      data: { parentId: parent.id, name: 'Kid One' },
    });
    const kid2 = await prisma.kid.create({
      data: { parentId: parent.id, name: 'Kid Two' },
    });
    kidIds = [kid1.id, kid2.id];
    userIds = [parent.id, parent2.id];

    // 2 distinct kid readers, one completed
    await prisma.storyProgress.create({
      data: {
        kidId: kid1.id,
        storyId,
        completed: true,
        totalTimeSpent: 120,
        lastAccessed: new Date(),
      },
    });
    await prisma.storyProgress.create({
      data: {
        kidId: kid2.id,
        storyId,
        completed: false,
        totalTimeSpent: 60,
        lastAccessed: new Date(),
      },
    });
    // 1 distinct direct-parent reader (parent2 reading without a kid profile)
    await prisma.userStoryProgress.create({
      data: {
        userId: parent2.id,
        storyId,
        completed: false,
        totalTimeSpent: 30,
        lastAccessed: new Date(),
      },
    });
  });

  afterEach(async () => {
    await prisma.storyProgress.deleteMany({ where: { storyId } });
    await prisma.userStoryProgress.deleteMany({ where: { storyId } });
    await prisma.kid.deleteMany({ where: { id: { in: kidIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.story.deleteMany({ where: { id: storyId } });
  });

  it('counts distinct kid readers plus distinct direct-parent readers as one union', async () => {
    const start = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const end = new Date(Date.now() + 1000);
    const stats = await repo.getStoryReaderStats({ start, end });
    const row = stats.find((s) => s.storyId === storyId);
    expect(row).toBeDefined();
    expect(row!.distinctReaders).toBe(3); // 2 kids + 1 direct parent
    expect(row!.completedCount).toBe(1);
  });

  it('getStoryReaderStatsForStory returns the same totals for a single story, no range filter', async () => {
    const stats = await repo.getStoryReaderStatsForStory(storyId);
    expect(stats).not.toBeNull();
    expect(stats!.distinctReaders).toBe(3);
    expect(stats!.completedCount).toBe(1);
  });
});
