import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';

type Badge = {
  id: string;
  title: string;
  description: string;
  target?: number;
  minAge?: number; // inclusive
  maxAge?: number; // inclusive
  predicate?: (stats: any) => boolean; // final check
  progressFn?: (stats: any) => number;
};

@Injectable()
export class KidAchievementsService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertOwnership(kidId: string, parentId: string) {
    const kid = await this.prisma.kid.findUnique({
      where: { id: kidId },
      include: { avatar: true },
    });
    if (!kid) throw new NotFoundException('Kid not found');
    if (kid.parentId !== parentId) throw new ForbiddenException('Access denied');
    return kid;
  }

  // helper: parse age from kid.ageRange (supports "1", "1-2", "2-3", or null)
  private parseAge(ageRange?: string): number | null {
    if (!ageRange) return null;
    const trimmed = ageRange.trim();
    if (/^\d+$/.test(trimmed)) return Number(trimmed);
    const m = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      // return lower bound as representative age
      return Number(m[1]);
    }
    return null;
  }

  // compute unique days array (ISO date strings) and longest/current streak
  private computeStreaks(progresses: Array<{ lastAccessed: Date }>) {
    const days = Array.from(
      new Set(progresses.map((p) => new Date(p.lastAccessed).toISOString().slice(0, 10)))
    )
      .map((d) => new Date(d))
      .sort((a, b) => a.getTime() - b.getTime());

    if (days.length === 0) return { longest: 0, current: 0 };

    // compute longest consecutive days
    let longest = 1;
    let currentLongest = 1;
    for (let i = 1; i < days.length; i++) {
      const prev = days[i - 1];
      const curr = days[i];
      // difference in days
      const diff = Math.round((curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24));
      if (diff === 1) {
        currentLongest++;
      } else {
        if (currentLongest > longest) longest = currentLongest;
        currentLongest = 1;
      }
    }
    if (currentLongest > longest) longest = currentLongest;

    // compute current streak (ending today)
    const today = new Date();
    const isoToday = new Date(today.toISOString().slice(0, 10));
    let current = 0;
    for (let i = days.length - 1; i >= 0; i--) {
      const d = days[i];
      const diff = Math.round((isoToday.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
      if (diff === current) {
        current++;
      } else if (diff > current) {
        break;
      }
    }

    return { longest, current };
  }

  async getKidAchievements(kidId: string, parentId: string) {
    const kid = await this.assertOwnership(kidId, parentId);
    const age = this.parseAge(kid.ageRange) ?? null; // may be null

    // Fetch stats from DB
    const [storyProgresses, downloadsCount, favoritesCount, questionsCount, challengesCount] =
      await Promise.all([
        this.prisma.storyProgress.findMany({
          where: { kidId },
          select: { storyId: true, completed: true, progress: true, totalTimeSpent: true, lastAccessed: true },
        }),
        this.prisma.kidDownload.count({ where: { kidId } }),
        this.prisma.kidFavorite.count({ where: { kidId } }),
        this.prisma.questionAnswer.count({ where: { kidId } }),
        this.prisma.dailyChallengeAssignment.count({ where: { kidId, completed: true } }),
      ]);

    const storiesCompleted = storyProgresses.filter((p) => p.completed).length;
    const totalTime = storyProgresses.reduce((s, p) => s + (p.totalTimeSpent ?? 0), 0);
    const progresses = storyProgresses.map((p) => ({ lastAccessed: p.lastAccessed }));
    const streaks = this.computeStreaks(progresses);

    const stats = {
      storiesCompleted,
      totalTime,
      downloadsCount,
      favoritesCount,
      questionsCount,
      challengesCount,
      streaks,
      totalProgressEntries: storyProgresses.length,
    };

    // define age-based badges
    const BADGES: Badge[] = [
      {
        id: 'first_story',
        title: 'First Story Completed',
        description: 'Complete any story for the first time.',
        target: 1,
        predicate: (s) => s.storiesCompleted >= 1,
      },
      {
        id: 'three_stories',
        title: 'Three Stories',
        description: 'Complete three stories.',
        target: 3,
        predicate: (s) => s.storiesCompleted >= 3,
      },
      {
        id: 'five_stories',
        title: 'Five Stories',
        description: 'Complete five stories.',
        target: 5,
        predicate: (s) => s.storiesCompleted >= 5,
      },
      {
        id: 'time_5_min',
        title: '5 Minutes of Reading',
        description: 'Accumulate 5 minutes of reading time.',
        target: 5,
        minAge: 1,
        maxAge: 4,
        predicate: (s) => s.totalTime >= 5 * 60, // seconds
        progressFn: (s) => Math.min(Math.floor(s.totalTime / 60), 5),
      },
      {
        id: 'time_15_min',
        title: '15 Minutes of Reading',
        description: 'Accumulate 15 minutes of reading time.',
        target: 15,
        minAge: 1,
        maxAge: 4,
        predicate: (s) => s.totalTime >= 15 * 60,
        progressFn: (s) => Math.min(Math.floor(s.totalTime / 60), 15),
      },
      {
        id: 'first_favorite',
        title: 'First Favorite',
        description: 'Add your first story to favorites.',
        predicate: (s) => s.favoritesCount >= 1,
      },
      {
        id: 'first_download',
        title: 'First Download',
        description: 'Download a story for offline use.',
        predicate: (s) => s.downloadsCount >= 1,
      },
      {
        id: 'first_challenge',
        title: 'First Challenge Completed',
        description: 'Complete one daily challenge.',
        predicate: (s) => s.challengesCount >= 1,
      },
      {
        id: 'first_answer',
        title: 'First Answer',
        description: 'Answer a question for the first time (ages 3-4).',
        minAge: 3,
        maxAge: 4,
        predicate: (s) => s.questionsCount >= 1,
      },
      {
        id: 'three_answers',
        title: 'Three Answers',
        description: 'Answer three questions (ages 3-4).',
        minAge: 3,
        maxAge: 4,
        predicate: (s) => s.questionsCount >= 3,
      },
      {
        id: 'two_day_streak',
        title: '2-Day Streak',
        description: 'Read stories two days in a row.',
        predicate: (s) => s.streaks?.current >= 2,
      },
      {
        id: 'five_day_streak',
        title: '5-Day Streak',
        description: 'Read stories five days in a row.',
        predicate: (s) => s.streaks?.current >= 5,
      },
    ];

    // filter badges by age range if specified
    const applicable = BADGES.filter((b) => {
      if (b.minAge && age !== null && age < b.minAge) return false;
      if (b.maxAge && age !== null && age > b.maxAge) return false;
      return true;
    });

    const achievements = applicable.map((b) => {
      const earned = !!(b.predicate ? b.predicate(stats) : false);
      const progress = b.progressFn ? b.progressFn(stats) : undefined;
      return {
        id: b.id,
        title: b.title,
        description: b.description,
        earned,
        progress,
        target: b.target,
      };
    });

    return { achievements };
  }
}
