import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { PrismaAdminStoryRepository } from './prisma-admin-story.repository';

describe('PrismaAdminStoryRepository.findTitlesByIds', () => {
  let prisma: PrismaService;
  let repo: PrismaAdminStoryRepository;
  let storyIds: string[];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [PrismaService, PrismaAdminStoryRepository],
    }).compile();
    prisma = module.get(PrismaService);
    repo = module.get(PrismaAdminStoryRepository);

    const base = {
      description: 'd',
      language: 'en',
      coverImageUrl: 'x',
      audioUrl: 'x',
      isInteractive: false,
      ageMin: 3,
      ageMax: 6,
    };
    const a = await prisma.story.create({
      data: { ...base, title: 'Story A' },
    });
    const b = await prisma.story.create({
      data: { ...base, title: 'Story B' },
    });
    storyIds = [a.id, b.id];
  });

  afterEach(async () => {
    await prisma.story.deleteMany({ where: { id: { in: storyIds } } });
  });

  it('returns id and title pairs for the requested ids, in any order', async () => {
    const result = await repo.findTitlesByIds(storyIds);
    const titles = result.map((r) => r.title).sort();
    expect(titles).toEqual(['Story A', 'Story B']);
  });

  it('returns an empty array for an empty input', async () => {
    const result = await repo.findTitlesByIds([]);
    expect(result).toEqual([]);
  });
});
