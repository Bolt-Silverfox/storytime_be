import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import {
  DailyChallengeDto,
  AssignDailyChallengeDto,
  CompleteDailyChallengeDto,
  DailyChallengeAssignmentDto,
} from './dto/story.dto';
import { DailyChallengeAssignment, DailyChallenge } from '@prisma/client';

@Injectable()
export class DailyChallengeService {
  private readonly logger = new Logger(DailyChallengeService.name);

  constructor(private readonly prisma: PrismaService) {}

  // =====================
  // DAILY CHALLENGE CRUD
  // =====================

  async setDailyChallenge(dto: DailyChallengeDto) {
    const story = await this.prisma.story.findUnique({
      where: { id: dto.storyId, isDeleted: false },
    });
    if (!story) throw new NotFoundException('Story not found');
    return await this.prisma.dailyChallenge.create({ data: dto });
  }

  async getDailyChallenge(date: string) {
    return await this.prisma.dailyChallenge.findMany({
      where: { challengeDate: new Date(date), isDeleted: false },
      include: { story: true },
    });
  }

  // =====================
  // ASSIGNMENT MANAGEMENT
  // =====================

  private toDailyChallengeAssignmentDto(
    assignment: DailyChallengeAssignment,
  ): DailyChallengeAssignmentDto {
    return {
      id: assignment.id,
      kidId: assignment.kidId,
      challengeId: assignment.challengeId,
      completed: assignment.completed,
      completedAt: assignment.completedAt ?? undefined,
      assignedAt: assignment.assignedAt,
    };
  }

  async assignDailyChallenge(
    dto: AssignDailyChallengeDto,
  ): Promise<DailyChallengeAssignmentDto> {
    const kid = await this.prisma.kid.findUnique({
      where: { id: dto.kidId, isDeleted: false },
    });
    if (!kid) throw new NotFoundException('Kid not found');
    const challenge = await this.prisma.dailyChallenge.findUnique({
      where: { id: dto.challengeId, isDeleted: false },
    });
    if (!challenge) throw new NotFoundException('Daily challenge not found');

    const assignment = await this.prisma.dailyChallengeAssignment.create({
      data: { kidId: dto.kidId, challengeId: dto.challengeId },
    });
    return this.toDailyChallengeAssignmentDto(assignment);
  }

  async completeDailyChallenge(
    dto: CompleteDailyChallengeDto,
  ): Promise<DailyChallengeAssignmentDto> {
    const assignment = await this.prisma.dailyChallengeAssignment.update({
      where: { id: dto.assignmentId },
      data: { completed: true, completedAt: new Date() },
    });
    return this.toDailyChallengeAssignmentDto(assignment);
  }

  async getAssignmentsForKid(
    kidId: string,
  ): Promise<DailyChallengeAssignmentDto[]> {
    const kid = await this.prisma.kid.findUnique({
      where: { id: kidId, isDeleted: false },
    });
    if (!kid) throw new NotFoundException('Kid not found');
    const assignments = await this.prisma.dailyChallengeAssignment.findMany({
      where: { kidId },
    });
    return assignments.map((a: DailyChallengeAssignment) =>
      this.toDailyChallengeAssignmentDto(a),
    );
  }

  async getAssignmentById(
    id: string,
  ): Promise<DailyChallengeAssignmentDto | null> {
    const assignment = await this.prisma.dailyChallengeAssignment.findUnique({
      where: { id },
    });
    return assignment ? this.toDailyChallengeAssignmentDto(assignment) : null;
  }

  // =====================
  // AUTOMATED ASSIGNMENT
  // =====================

  async assignDailyChallengeToAllKids() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const kids = await this.prisma.kid.findMany({
      where: { isDeleted: false },
    });
    let totalAssigned = 0;

    for (const kid of kids) {
      let kidAge = 0;
      if (kid.ageRange) {
        const match = kid.ageRange.match(/(\d+)/);
        if (match) kidAge = parseInt(match[1], 10);
      }

      const stories = await this.prisma.story.findMany({
        where: {
          ageMin: { lte: kidAge },
          ageMax: { gte: kidAge },
          isDeleted: false,
        },
      });

      if (stories.length === 0) continue;

      const pastAssignments =
        await this.prisma.dailyChallengeAssignment.findMany({
          where: { kidId: kid.id },
          include: { challenge: true },
        });

      const usedStoryIds = new Set(
        pastAssignments.map(
          (a: DailyChallengeAssignment & { challenge: DailyChallenge }) =>
            a.challenge.storyId,
        ),
      );

      const availableStories = stories.filter(
        (s: { id: string }) => !usedStoryIds.has(s.id),
      );
      const storyPool =
        availableStories.length > 0 ? availableStories : stories;
      const story = storyPool[Math.floor(Math.random() * storyPool.length)];

      const wordOfTheDay = story.title;
      const description = story.description ?? '';
      const meaning = description
        ? description.split('. ')[0] + (description.includes('.') ? '.' : '')
        : '';

      let challenge = await this.prisma.dailyChallenge.findFirst({
        where: { storyId: story.id, challengeDate: today, isDeleted: false },
      });

      if (!challenge) {
        challenge = await this.prisma.dailyChallenge.create({
          data: {
            storyId: story.id,
            challengeDate: today,
            wordOfTheDay,
            meaning,
          },
        });
      }

      const existingAssignment =
        await this.prisma.dailyChallengeAssignment.findFirst({
          where: { kidId: kid.id, challengeId: challenge.id },
        });

      if (!existingAssignment) {
        await this.prisma.dailyChallengeAssignment.create({
          data: { kidId: kid.id, challengeId: challenge.id },
        });
        this.logger.log(
          `Assigned story '${story.title}' to kid '${kid.name ?? kid.id}' for daily challenge.`,
        );
        totalAssigned++;
      }
    }

    this.logger.log(
      `Daily challenge assignment complete. Total assignments: ${totalAssigned}`,
    );
  }

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleDailyChallengeAssignment() {
    await this.assignDailyChallengeToAllKids();
    this.logger.log('Daily challenges assigned to all kids at midnight');
  }

  // =====================
  // QUERIES
  // =====================

  async getTodaysDailyChallengeAssignment(kidId: string) {
    const kid = await this.prisma.kid.findUnique({
      where: { id: kidId, isDeleted: false },
    });
    if (!kid) throw new NotFoundException('Kid not found');

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);

    const assignment = await this.prisma.dailyChallengeAssignment.findFirst({
      where: {
        kidId,
        challenge: {
          challengeDate: { gte: today, lt: tomorrow },
          isDeleted: false,
        },
      },
      include: { challenge: { include: { story: true } } },
    });

    if (!assignment)
      throw new NotFoundException(
        'No daily challenge assignment found for today',
      );

    return assignment;
  }

  async getWeeklyDailyChallengeAssignments(kidId: string, weekStart: Date) {
    const kid = await this.prisma.kid.findUnique({
      where: { id: kidId, isDeleted: false },
    });
    if (!kid) throw new NotFoundException('Kid not found');

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7);

    const assignments = await this.prisma.dailyChallengeAssignment.findMany({
      where: {
        kidId,
        challenge: {
          challengeDate: { gte: weekStart, lt: weekEnd },
          isDeleted: false,
        },
      },
      include: { challenge: { include: { story: true } } },
      orderBy: { assignedAt: 'asc' },
    });

    return assignments;
  }
}
