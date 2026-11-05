import { PrismaAdminStoryRepository } from './prisma-admin-story.repository';

describe('PrismaAdminStoryRepository.findStoryById provenance opt-in', () => {
  it('opts in to adaptationNotes and importedAt only (global omit hides them by default)', async () => {
    const findUnique = jest.fn().mockResolvedValue(null);
    const repo = new PrismaAdminStoryRepository({
      story: { findUnique },
    } as any);
    await repo.findStoryById('s1');
    const args = findUnique.mock.calls[0][0];
    expect(args.omit).toEqual({ adaptationNotes: false, importedAt: false });
  });
});
