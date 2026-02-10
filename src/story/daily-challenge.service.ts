import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { STORY_REPOSITORY, IStoryRepository } from './repositories';
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

  constructor(
    @Inject(STORY_REPOSITORY)
    private readonly storyRepository: IStoryRepository,
  ) {}

  // =====================
  // DAILY CHALLENGE CRUD
  // =====================

  async setDailyChallenge(dto: DailyChallengeDto) {
    const story = await this.storyRepository.findStoryById(dto.storyId);
    if (!story) throw new NotFoundException('Story not found');
    return await this.storyRepository.createDailyChallenge({
      story: { connect: { id: dto.storyId } },
      challengeDate: dto.challengeDate,
      wordOfTheDay: dto.wordOfTheDay,
      meaning: dto.meaning,
    });
  }

  async getDailyChallenge(date: string) {
    return await this.storyRepository.findDailyChallengesByDate(new Date(date));
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
    const kid = await this.storyRepository.findKidById(dto.kidId);
    if (!kid) throw new NotFoundException('Kid not found');

    // Check if daily challenge exists by looking up by date and story
    // Note: Repository doesn't have findDailyChallengeById, use findDailyChallengeAssignmentById to verify
    const assignment =
      await this.storyRepository.createDailyChallengeAssignment(
        dto.kidId,
        dto.challengeId,
      );
    return this.toDailyChallengeAssignmentDto(assignment);
  }

  async completeDailyChallenge(
    dto: CompleteDailyChallengeDto,
  ): Promise<DailyChallengeAssignmentDto> {
    const assignment =
      await this.storyRepository.updateDailyChallengeAssignment(
        dto.assignmentId,
        { completed: true, completedAt: new Date() },
      );
    return this.toDailyChallengeAssignmentDto(assignment);
  }

  async getAssignmentsForKid(
    kidId: string,
  ): Promise<DailyChallengeAssignmentDto[]> {
    const kid = await this.storyRepository.findKidById(kidId);
    if (!kid) throw new NotFoundException('Kid not found');
    const assignments =
      await this.storyRepository.findDailyChallengeAssignmentsForKid(kidId);
    return assignments.map((a: DailyChallengeAssignment) =>
      this.toDailyChallengeAssignmentDto(a),
    );
  }

  async getAssignmentById(
    id: string,
  ): Promise<DailyChallengeAssignmentDto | null> {
    const assignment =
      await this.storyRepository.findDailyChallengeAssignmentById(id);
    return assignment ? this.toDailyChallengeAssignmentDto(assignment) : null;
  }

  // =====================
  // AUTOMATED ASSIGNMENT
  // =====================

  async assignDailyChallengeToAllKids() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Batch fetch all required data upfront
    const [kids, allStories, allPastAssignments] = await Promise.all([
      this.storyRepository.findAllKids(),
      this.storyRepository.findStories({ where: { isDeleted: false } }),
      this.storyRepository.findAllDailyChallengeAssignments(),
    ]);

    let totalAssigned = 0;

    for (const kid of kids) {
      let kidAge = 0;
      if (kid.ageRange) {
        const match = kid.ageRange.match(/(\d+)/);
        if (match) kidAge = parseInt(match[1], 10);
      }

      // Filter stories by age from pre-fetched data
      const stories = allStories.filter(
        (s) =>
          (s.ageMin === null || s.ageMin <= kidAge) &&
          (s.ageMax === null || s.ageMax >= kidAge),
      );

      if (stories.length === 0) continue;

      // Filter past assignments for this kid from pre-fetched data
      const pastAssignments = allPastAssignments.filter(
        (a) => a.kidId === kid.id,
      );

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

      let challenge =
        await this.storyRepository.findDailyChallengeByStoryAndDate(
          story.id,
          today,
        );

      if (!challenge) {
        challenge = await this.storyRepository.createDailyChallenge({
          story: { connect: { id: story.id } },
          challengeDate: today,
          wordOfTheDay,
          meaning,
        });
      }

      // Check if assignment exists from pre-fetched data
      const existingAssignment = allPastAssignments.find(
        (a) => a.kidId === kid.id && a.challengeId === challenge.id,
      );

      if (!existingAssignment) {
        await this.storyRepository.createDailyChallengeAssignment(
          kid.id,
          challenge.id,
        );
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
    const kid = await this.storyRepository.findKidById(kidId);
    if (!kid) throw new NotFoundException('Kid not found');

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);

    const assignment =
      await this.storyRepository.findTodaysDailyChallengeAssignment(
        kidId,
        today,
        tomorrow,
      );

    if (!assignment)
      throw new NotFoundException(
        'No daily challenge assignment found for today',
      );

    return assignment;
  }

  async getWeeklyDailyChallengeAssignments(kidId: string, weekStart: Date) {
    const kid = await this.storyRepository.findKidById(kidId);
    if (!kid) throw new NotFoundException('Kid not found');

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7);

    const assignments =
      await this.storyRepository.findWeeklyDailyChallengeAssignments(
        kidId,
        weekStart,
        weekEnd,
      );

    return assignments;
  }
}
