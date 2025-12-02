import { PrismaService } from '../prisma/prisma.service';
import {
  CreateStoryDto,
  UpdateStoryDto,
  StoryImageDto,
  StoryBranchDto,
  FavoriteDto,
  StoryProgressDto,
  DailyChallengeDto,
  UploadVoiceDto,
  CreateElevenLabsVoiceDto,
  SetPreferredVoiceDto,
  VoiceResponseDto,
  AssignDailyChallengeDto,
  CompleteDailyChallengeDto,
  DailyChallengeAssignmentDto,
  StartStoryPathDto,
  UpdateStoryPathDto,
  StoryPathDto,
  CategoryDto,
  ThemeDto,
  VoiceType,
} from './story.dto';
import { ElevenLabsService } from './elevenlabs.service';
import { UploadService } from '../upload/upload.service';
import {
  StoryPath,
  Voice,
  DailyChallengeAssignment,
  Category,
  Theme,
  DailyChallenge,
} from '@prisma/client';
import { Cron, CronExpression } from '@nestjs/schedule';
import { TextToSpeechService } from './text-to-speech.service';
import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { GeminiService, GenerateStoryOptions } from './gemini.service';

import { AgeService } from '../age/age.service';

@Injectable()
export class StoryService {
  private readonly logger = new Logger(StoryService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly elevenLabs: ElevenLabsService,
    public readonly uploadService: UploadService,
    private readonly textToSpeechService: TextToSpeechService,
    private readonly geminiService: GeminiService,
    private readonly ageService: AgeService,
  ) {}

  async getStories(filter: {
    theme?: string;
    category?: string;
    recommended?: boolean;
    age?: number;
    kidId?: string;
  }) {
    const where: any = {
      isDeleted: false, // EXCLUDE SOFT DELETED STORIES
    };

    if (filter.theme) where.themes = { some: { id: filter.theme } };
    if (filter.category) where.categories = { some: { id: filter.category } };

    // Filter by the boolean 'recommended' flag on the Story model
    if (filter.recommended !== undefined)
      where.recommended = filter.recommended;

    let targetLevel: number | undefined;

    if (filter.kidId) {
      const kid = await this.prisma.kid.findUnique({
        where: {
          id: filter.kidId,
          isDeleted: false, // CANNOT GET STORIES FOR SOFT DELETED KIDS
        },
        // Include preferred categories and age group
        include: { preferredCategories: true, ageGroup: true },
      });

      if (kid) {
        // --- 1. Age / Reading Level Logic (Existing) ---
        // Prioritize Reading Level if available
        if (kid.currentReadingLevel > 0) {
          targetLevel = kid.currentReadingLevel;
          //let learning be around +/- 1 level
          where.difficultyLevel = {
            gte: Math.max(1, targetLevel - 1),
            lte: targetLevel + 1,
          };
        }
        // Fallback to Age Group
        else if (kid.ageGroup) {
          where.ageMin = { lte: kid.ageGroup.max };
          where.ageMax = { gte: kid.ageGroup.min };
        }

        // --- 2. Recommended Category Logic ---
        // If we want recommendations AND the kid has preferences
        if (filter.recommended === true && kid.preferredCategories.length > 0) {
          // Remove the static DB flag check.
          // We are switching from "Editor's Choice" to "Personalized For You"...active boys and girls
          delete where.recommended;

          const categoryIds = kid.preferredCategories.map((c) => c.id);

          // Add to existing where clause (merges with Age/Level logic)
          where.categories = {
            some: {
              id: { in: categoryIds },
            },
          };
        }
      }
    }

    // Only use manual age filter if we haven't already filtered by difficulty/kid
    if (filter.age && !targetLevel && !where.ageMin) {
      where.ageMin = { lte: filter.age };
      where.ageMax = { gte: filter.age };
    }

    const stories = await this.prisma.story.findMany({
      where,
      include: {
        images: true,
        branches: true,
        categories: true,
        themes: true,
        questions: true,
        ageGroup: true,
      },
    });
    return stories.map((story) => ({
      ...story,
      ageGroup: story.ageGroup
        ? `${story.ageGroup.min}-${story.ageGroup.max}`
        : undefined,
    }));
  }

  async createStory(data: CreateStoryDto) {
    let audioUrl = data.audioUrl;
    if (!audioUrl && data.description) {
      const { buffer, filename } = await this.elevenLabs.generateAudioBuffer(
        data.description,
      );
      audioUrl = await this.uploadService.uploadAudioBuffer(buffer, filename);
    }
    if (!audioUrl) {
      throw new Error(
        'audioUrl or description is required to generate story audio.',
      );
    }
    let ageGroupId: string | undefined;
    let ageMin = data.ageMin ?? 0;
    let ageMax = data.ageMax ?? 9;

    if (data.ageRange) {
      const ageGroup = await this.ageService.findGroupForRange(data.ageRange);
      ageGroupId = ageGroup.id;
      ageMin = ageGroup.min;
      ageMax = ageGroup.max;
    }

    const story = await this.prisma.story.create({
      data: {
        title: data.title,
        description: data.description,
        language: data.language,
        coverImageUrl: data.coverImageUrl ?? '',
        audioUrl,
        isInteractive: data.isInteractive ?? false,
        ageMin,
        ageMax,
        ageGroup: ageGroupId ? { connect: { id: ageGroupId } } : undefined,
        images: data.images ? { create: data.images } : undefined,
        branches: data.branches ? { create: data.branches } : undefined,
        categories: { connect: data.categoryIds.map((id) => ({ id })) },
        themes: { connect: data.themeIds.map((id) => ({ id })) },
      },
      include: { images: true, branches: true, ageGroup: true },
    });

    return {
      ...story,
      ageGroup: story.ageGroup
        ? `${story.ageGroup.min}-${story.ageGroup.max}`
        : undefined,
    };
  }

  async updateStory(id: string, data: UpdateStoryDto) {
    const story = await this.prisma.story.findUnique({
      where: {
        id,
        isDeleted: false, // CANNOT UPDATE SOFT DELETED STORIES
      },
    });

    if (!story) {
      throw new NotFoundException('Story not found');
    }

    let audioUrl = data.audioUrl;
    if (!audioUrl && data.description) {
      const { buffer, filename } = await this.elevenLabs.generateAudioBuffer(
        data.description,
      );
      audioUrl = await this.uploadService.uploadAudioBuffer(buffer, filename);
    }

    let ageGroupId: string | undefined;
    let ageMin = data.ageMin;
    let ageMax = data.ageMax;

    if (data.ageRange) {
      const ageGroup = await this.ageService.findGroupForRange(data.ageRange);
      ageGroupId = ageGroup.id;
      ageMin = ageGroup.min;
      ageMax = ageGroup.max;
    }

    const updatedStory = await this.prisma.story.update({
      where: { id },
      data: {
        title: data.title,
        description: data.description,
        language: data.language,
        coverImageUrl: data.coverImageUrl,
        isInteractive: data.isInteractive,
        ageMin,
        ageMax,
        ageGroup: ageGroupId ? { connect: { id: ageGroupId } } : undefined,
        audioUrl,
        images: data.images ? { create: data.images } : undefined,
        branches: data.branches ? { create: data.branches } : undefined,
        categories: data.categoryIds
          ? { set: data.categoryIds.map((id) => ({ id })) }
          : undefined,
        themes: data.themeIds
          ? { set: data.themeIds.map((id) => ({ id })) }
          : undefined,
      },
      include: { images: true, branches: true, ageGroup: true },
    });

    return {
      ...updatedStory,
      ageGroup: updatedStory.ageGroup
        ? `${updatedStory.ageGroup.min}-${updatedStory.ageGroup.max}`
        : undefined,
    };
  }

  /**
   * Soft delete or permanently delete a story
   * @param id Story ID
   * @param permanent Whether to permanently delete (default: false)
   */
  async deleteStory(id: string, permanent: boolean = false) {
    const story = await this.prisma.story.findUnique({
      where: {
        id,
        isDeleted: false, // CANNOT DELETE ALREADY DELETED STORIES
      },
    });

    if (!story) {
      throw new NotFoundException('Story not found');
    }

    if (permanent) {
      return await this.prisma.story.delete({ where: { id } });
    } else {
      return await this.prisma.story.update({
        where: { id },
        data: {
          isDeleted: true,
          deletedAt: new Date(),
        },
      });
    }
  }

  /**
   * Restore a soft deleted story
   * @param id Story ID
   */
  async undoDeleteStory(id: string) {
    const story = await this.prisma.story.findUnique({
      where: { id },
    });

    if (!story) {
      throw new NotFoundException('Story not found');
    }

    if (!story.isDeleted) {
      throw new BadRequestException('Story is not deleted');
    }

    return await this.prisma.story.update({
      where: { id },
      data: {
        isDeleted: false,
        deletedAt: null,
      },
    });
  }

  // --- Images ---
  async addImage(storyId: string, image: StoryImageDto) {
    const story = await this.prisma.story.findUnique({
      where: {
        id: storyId,
        isDeleted: false, // CANNOT ADD IMAGES TO SOFT DELETED STORIES
      },
    });

    if (!story) {
      throw new NotFoundException('Story not found');
    }

    return await this.prisma.storyImage.create({
      data: { ...image, storyId },
    });
  }

  // --- Branches ---
  async addBranch(storyId: string, branch: StoryBranchDto) {
    const story = await this.prisma.story.findUnique({
      where: {
        id: storyId,
        isDeleted: false, // CANNOT ADD BRANCHES TO SOFT DELETED STORIES
      },
    });

    if (!story) {
      throw new NotFoundException('Story not found');
    }

    return await this.prisma.storyBranch.create({
      data: { ...branch, storyId },
    });
  }

  // --- Favorites ---
  async addFavorite(dto: FavoriteDto) {
    // Verify both kid and story exist and are not soft deleted
    const kid = await this.prisma.kid.findUnique({
      where: {
        id: dto.kidId,
        isDeleted: false, // CANNOT ADD FAVORITES FOR SOFT DELETED KIDS
      },
    });

    if (!kid) {
      throw new NotFoundException('Kid not found');
    }

    const story = await this.prisma.story.findUnique({
      where: {
        id: dto.storyId,
        isDeleted: false, // CANNOT ADD SOFT DELETED STORIES TO FAVORITES
      },
    });

    if (!story) {
      throw new NotFoundException('Story not found');
    }

    return await this.prisma.favorite.create({
      data: { kidId: dto.kidId, storyId: dto.storyId },
    });
  }

  async removeFavorite(kidId: string, storyId: string) {
    return await this.prisma.favorite.deleteMany({
      where: { kidId, storyId },
    });
  }

  async getFavorites(kidId: string) {
    const kid = await this.prisma.kid.findUnique({
      where: {
        id: kidId,
        isDeleted: false, // CANNOT GET FAVORITES FOR SOFT DELETED KIDS
      },
    });

    if (!kid) {
      throw new NotFoundException('Kid not found');
    }

    return await this.prisma.favorite.findMany({
      where: { kidId },
      include: { story: true },
    });
  }

  // --- Progress ---

  async setProgress(dto: StoryProgressDto & { sessionTime?: number }) {
    // Verify both kid and story exist and are not soft deleted
    const kid = await this.prisma.kid.findUnique({
      where: {
        id: dto.kidId,
        isDeleted: false, // CANNOT SET PROGRESS FOR SOFT DELETED KIDS
      },
    });

    if (!kid) {
      throw new NotFoundException('Kid not found');
    }

    const story = await this.prisma.story.findUnique({
      where: {
        id: dto.storyId,
        isDeleted: false, // CANNOT SET PROGRESS FOR SOFT DELETED STORIES
      },
    });

    if (!story) {
      throw new NotFoundException('Story not found');
    }

    // Get existing progress to calculate total time
    const existing = await this.prisma.storyProgress.findUnique({
      where: { kidId_storyId: { kidId: dto.kidId, storyId: dto.storyId } },
    });

    const sessionTime = dto.sessionTime || 0;
    const newTotalTime = (existing?.totalTimeSpent || 0) + sessionTime;

    const result = await this.prisma.storyProgress.upsert({
      where: { kidId_storyId: { kidId: dto.kidId, storyId: dto.storyId } },
      update: {
        progress: dto.progress,
        completed: dto.completed ?? false,
        lastAccessed: new Date(),
        totalTimeSpent: newTotalTime,
      },
      create: {
        kidId: dto.kidId,
        storyId: dto.storyId,
        progress: dto.progress,
        completed: dto.completed ?? false,
        totalTimeSpent: sessionTime,
      },
    });

    // Trigger auto-adjustment if story just completed
    if (dto.completed && (!existing || !existing.completed)) {
      // Fire and forget (don't await) to keep API fast
      this.adjustReadingLevel(dto.kidId, dto.storyId, newTotalTime).catch((e) =>
        this.logger.error(`Failed to adjust reading level: ${e.message}`),
      );
    }

    return result;
  }

  async getProgress(kidId: string, storyId: string) {
    const kid = await this.prisma.kid.findUnique({
      where: {
        id: kidId,
        isDeleted: false, // CANNOT GET PROGRESS FOR SOFT DELETED KIDS
      },
    });

    if (!kid) {
      throw new NotFoundException('Kid not found');
    }

    const story = await this.prisma.story.findUnique({
      where: {
        id: storyId,
        isDeleted: false, // CANNOT GET PROGRESS FOR SOFT DELETED STORIES
      },
    });

    if (!story) {
      throw new NotFoundException('Story not found');
    }

    return await this.prisma.storyProgress.findUnique({
      where: { kidId_storyId: { kidId, storyId } },
    });
  }

  // --- Daily Challenge ---
  async setDailyChallenge(dto: DailyChallengeDto) {
    const story = await this.prisma.story.findUnique({
      where: {
        id: dto.storyId,
        isDeleted: false, // CANNOT CREATE CHALLENGES FOR SOFT DELETED STORIES
      },
    });

    if (!story) {
      throw new NotFoundException('Story not found');
    }

    return await this.prisma.dailyChallenge.create({ data: dto });
  }

  async getDailyChallenge(date: string) {
    return await this.prisma.dailyChallenge.findMany({
      where: {
        challengeDate: new Date(date),
        isDeleted: false, // EXCLUDE SOFT DELETED CHALLENGES
      },
      include: { story: true },
    });
  }

  // --- Daily Challenge Assignment ---
  private toDailyChallengeAssignmentDto(
    assignment: any,
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
    // Verify kid and challenge exist and are not soft deleted
    const kid = await this.prisma.kid.findUnique({
      where: {
        id: dto.kidId,
        isDeleted: false, // CANNOT ASSIGN CHALLENGES TO SOFT DELETED KIDS
      },
    });

    if (!kid) {
      throw new NotFoundException('Kid not found');
    }

    const challenge = await this.prisma.dailyChallenge.findUnique({
      where: {
        id: dto.challengeId,
        isDeleted: false, // CANNOT ASSIGN SOFT DELETED CHALLENGES
      },
    });

    if (!challenge) {
      throw new NotFoundException('Daily challenge not found');
    }

    const assignment = await this.prisma.dailyChallengeAssignment.create({
      data: {
        kidId: dto.kidId,
        challengeId: dto.challengeId,
      },
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
      where: {
        id: kidId,
        isDeleted: false, // CANNOT GET ASSIGNMENTS FOR SOFT DELETED KIDS
      },
    });

    if (!kid) {
      throw new NotFoundException('Kid not found');
    }

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

  // --- Voices ---
  async uploadVoice(
    userId: string,
    fileUrl: string,
    dto: UploadVoiceDto,
  ): Promise<VoiceResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
        isDeleted: false, // CANNOT UPLOAD VOICES FOR SOFT DELETED USERS
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const voice = await this.prisma.voice.create({
      data: {
        userId,
        name: dto.name,
        type: 'uploaded',
        url: fileUrl,
      },
    });
    return this.toVoiceResponse(voice);
  }

  async createElevenLabsVoice(
    userId: string,
    dto: CreateElevenLabsVoiceDto,
  ): Promise<VoiceResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
        isDeleted: false, // CANNOT CREATE VOICES FOR SOFT DELETED USERS
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const voice = await this.prisma.voice.create({
      data: {
        userId,
        name: dto.name,
        type: 'elevenlabs',
        elevenLabsVoiceId: dto.elevenLabsVoiceId,
      },
    });
    return this.toVoiceResponse(voice);
  }

  async listVoices(userId: string): Promise<VoiceResponseDto[]> {
    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
        isDeleted: false, // CANNOT LIST VOICES FOR SOFT DELETED USERS
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const voices = await this.prisma.voice.findMany({
      where: {
        userId,
        isDeleted: false, // EXCLUDE SOFT DELETED VOICES
      },
    });
    return voices.map((v: Voice) => this.toVoiceResponse(v));
  }

  async setPreferredVoice(
    userId: string,
    dto: SetPreferredVoiceDto,
  ): Promise<any> {
    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
        isDeleted: false, // CANNOT SET PREFERRED VOICE FOR SOFT DELETED USERS
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Verify the voice exists and is not soft deleted
    if (dto.voiceId) {
      const voice = await this.prisma.voice.findUnique({
        where: {
          id: dto.voiceId,
          isDeleted: false, // CANNOT SET SOFT DELETED VOICE AS PREFERRED
        },
      });

      if (!voice) {
        throw new NotFoundException('Voice not found');
      }
    }

    const result = await this.prisma.user.update({
      where: { id: userId },
      data: { preferredVoiceId: dto.voiceId },
    });
    return {
      id: result.id,
      email: result.email,
      name: result.name,
      preferredVoice: result.preferredVoiceId,
    };
  }

  async getPreferredVoice(userId: string): Promise<VoiceResponseDto | null> {
    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
        isDeleted: false, // CANNOT GET PREFERRED VOICE FOR SOFT DELETED USERS
      },
      include: { preferredVoice: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!user.preferredVoice)
      return {
        id: '',
        name: '',
        type: '',
        url: undefined,
        elevenLabsVoiceId: undefined,
      };
    return this.toVoiceResponse(user.preferredVoice);
  }

  private toVoiceResponse(voice: any): VoiceResponseDto {
    return {
      id: voice.id,
      name: voice.name,
      type: voice.type,
      url: voice.url ?? undefined,
      elevenLabsVoiceId: voice.elevenLabsVoiceId ?? undefined,
    };
  }

  // Update audio generation to use preferred voice
  async generateStoryAudio(
    userId: string,
    text: string,
  ): Promise<{ buffer: Buffer; filename: string }> {
    const user = await this.prisma.user.findUnique({
      where: {
        id: userId,
        isDeleted: false, // CANNOT GENERATE AUDIO FOR SOFT DELETED USERS
      },
      include: { preferredVoice: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    let voice: string | undefined = undefined;
    if (user && user.preferredVoice) {
      const prefVoice = user.preferredVoice;
      if (prefVoice.type === 'elevenlabs' && prefVoice.elevenLabsVoiceId) {
        voice = prefVoice.elevenLabsVoiceId;
      }
      // For uploaded voices, you may want to return the uploaded file directly or handle differently
    }
    return this.elevenLabs.generateAudioBuffer(text, voice);
  }

  private toStoryPathDto(path: StoryPath): StoryPathDto {
    return {
      id: path.id,
      kidId: path.kidId,
      storyId: path.storyId,
      path: path.path,
      startedAt: path.startedAt,
      completedAt: path.completedAt ?? undefined,
    };
  }

  async startStoryPath(dto: StartStoryPathDto): Promise<StoryPathDto> {
    // Verify kid and story exist and are not soft deleted
    const kid = await this.prisma.kid.findUnique({
      where: {
        id: dto.kidId,
        isDeleted: false, // CANNOT START STORY PATH FOR SOFT DELETED KIDS
      },
    });

    if (!kid) {
      throw new NotFoundException('Kid not found');
    }

    const story = await this.prisma.story.findUnique({
      where: {
        id: dto.storyId,
        isDeleted: false, // CANNOT START STORY PATH FOR SOFT DELETED STORIES
      },
    });

    if (!story) {
      throw new NotFoundException('Story not found');
    }

    const storyPath = await this.prisma.storyPath.create({
      data: {
        kidId: dto.kidId,
        storyId: dto.storyId,
        path: '',
      },
    });
    return this.toStoryPathDto(storyPath);
  }

  async updateStoryPath(dto: UpdateStoryPathDto): Promise<StoryPathDto> {
    const storyPath = await this.prisma.storyPath.update({
      where: { id: dto.pathId },
      data: {
        path: dto.path,
        completedAt: dto.completedAt,
      },
    });
    return this.toStoryPathDto(storyPath);
  }

  async getStoryPathsForKid(kidId: string): Promise<StoryPathDto[]> {
    const kid = await this.prisma.kid.findUnique({
      where: {
        id: kidId,
        isDeleted: false, // CANNOT GET STORY PATHS FOR SOFT DELETED KIDS
      },
    });

    if (!kid) {
      throw new NotFoundException('Kid not found');
    }

    const paths = await this.prisma.storyPath.findMany({ where: { kidId } });
    return paths.map((p: StoryPath) => this.toStoryPathDto(p));
  }

  async getStoryPathById(id: string): Promise<StoryPathDto | null> {
    const path = await this.prisma.storyPath.findUnique({ where: { id } });
    return path ? this.toStoryPathDto(path) : null;
  }

  async fetchAvailableVoices(): Promise<any[]> {
    return this.elevenLabs.fetchAvailableVoices();
  }

  async getCategories(): Promise<CategoryDto[]> {
    const categories = await this.prisma.category.findMany({
      where: {
        isDeleted: false, // EXCLUDE SOFT DELETED CATEGORIES
      },
    });
    return categories.map((c: Category) => ({
      ...c,
      image: c.image ?? undefined,
      description: c.description ?? undefined,
    }));
  }

  async getThemes(): Promise<ThemeDto[]> {
    const themes = await this.prisma.theme.findMany({
      where: {
        isDeleted: false, // EXCLUDE SOFT DELETED THEMES
      },
    });
    return themes.map((t: Theme) => ({
      ...t,
      image: t.image ?? undefined,
      description: t.description ?? undefined,
    }));
  }

  // --- Daily Challenge Automation ---
  async assignDailyChallengeToAllKids() {
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Normalize to midnight

    const kids = await this.prisma.kid.findMany({
      where: {
        isDeleted: false, // ONLY ASSIGN TO NON-DELETED KIDS
      },
      include: { ageGroup: true },
    });

    let totalAssigned = 0;
    for (const kid of kids) {
      // Get kid's age from ageGroup
      let kidAge = 0;
      if (kid.ageGroup) {
        kidAge = kid.ageGroup.min; // Use the minimum age from the age group
      }
      // Get all age-appropriate stories
      const stories = await this.prisma.story.findMany({
        where: {
          ageMin: { lte: kidAge },
          ageMax: { gte: kidAge },
          isDeleted: false, // ONLY USE NON-DELETED STORIES
        },
      });
      if (stories.length === 0) continue;

      // Get all challenges assigned to this kid in the past
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
      // Filter out stories already assigned
      const availableStories = stories.filter(
        (s: any) => !usedStoryIds.has(s.id),
      );
      // If all stories have been used, reset (allow repeats)
      const storyPool =
        availableStories.length > 0 ? availableStories : stories;
      const story = storyPool[Math.floor(Math.random() * storyPool.length)];

      // Use story title as wordOfTheDay, first sentence of description as meaning
      const wordOfTheDay = story.title;
      const meaning =
        story.description.split('. ')[0] +
        (story.description.includes('.') ? '.' : '');

      // Create or find today's challenge for this story
      let challenge = await this.prisma.dailyChallenge.findFirst({
        where: {
          storyId: story.id,
          challengeDate: today,
          isDeleted: false, // ONLY USE NON-DELETED CHALLENGES
        },
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

      // Assign to kid if not already assigned
      const existingAssignment =
        await this.prisma.dailyChallengeAssignment.findFirst({
          where: {
            kidId: kid.id,
            challengeId: challenge.id,
          },
        });
      if (!existingAssignment) {
        await this.prisma.dailyChallengeAssignment.create({
          data: {
            kidId: kid.id,
            challengeId: challenge.id,
          },
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

  async getTodaysDailyChallengeAssignment(kidId: string) {
    const kid = await this.prisma.kid.findUnique({
      where: {
        id: kidId,
        isDeleted: false, // CANNOT GET CHALLENGES FOR SOFT DELETED KIDS
      },
    });

    if (!kid) {
      throw new NotFoundException('Kid not found');
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const assignment = await this.prisma.dailyChallengeAssignment.findFirst({
      where: {
        kidId,
        challenge: {
          challengeDate: {
            gte: today,
            lt: tomorrow,
          },
          isDeleted: false, // ONLY GET NON-DELETED CHALLENGES
        },
      },
      include: {
        challenge: {
          include: {
            story: true,
          },
        },
      },
    });
    if (!assignment) {
      throw new NotFoundException(
        'No daily challenge assignment found for today',
      );
    }
    return assignment;
  }

  async getStoryAudioUrl(
    storyId: string,
    voiceType: VoiceType,
  ): Promise<string> {
    const story = await this.prisma.story.findUnique({
      where: {
        id: storyId,
        isDeleted: false, // CANNOT GET AUDIO FOR SOFT DELETED STORIES
      },
      select: { textContent: true },
    });
    if (!story) {
      throw new NotFoundException(`Story with ID ${storyId} not found`);
    }

    // check StoryAudioCache model for storyId and voiceType
    const cachedAudio = await this.prisma.storyAudioCache.findFirst({
      where: { storyId, voiceType },
    });
    if (cachedAudio) {
      return cachedAudio.audioUrl;
    }

    // If not cached, generate audio using text-to-speech service
    const audioUrl = await this.textToSpeechService.textToSpeechCloudUrl(
      storyId,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      story?.textContent ?? '',
      voiceType,
    );

    // Cache the generated audio URL
    await this.prisma.storyAudioCache.create({
      data: {
        storyId,
        voiceType,
        audioUrl,
      },
    });

    return audioUrl;
  }

  async getWeeklyDailyChallengeAssignments(kidId: string, weekStart: Date) {
    const kid = await this.prisma.kid.findUnique({
      where: {
        id: kidId,
        isDeleted: false, // CANNOT GET ASSIGNMENTS FOR SOFT DELETED KIDS
      },
    });

    if (!kid) {
      throw new NotFoundException('Kid not found');
    }

    // weekStart should be a Sunday at 00:00:00
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7); // Next Sunday (exclusive)
    const assignments = await this.prisma.dailyChallengeAssignment.findMany({
      where: {
        kidId,
        challenge: {
          challengeDate: {
            gte: weekStart,
            lt: weekEnd,
          },
          isDeleted: false, // ONLY GET NON-DELETED CHALLENGES
        },
      },
      include: {
        challenge: {
          include: {
            story: true,
          },
        },
      },
      orderBy: { assignedAt: 'asc' },
    });
    return assignments;
  }

  async getStoryById(id: string) {
    const story = await this.prisma.story.findUnique({
      where: {
        id,
        isDeleted: false, // EXCLUDE SOFT DELETED STORIES
      },
      include: {
        images: true,
        branches: true,
        categories: true,
        themes: true,
        questions: true,
      },
    });
    if (!story) {
      throw new NotFoundException(`Story with id ${id} not found`);
    }
    return story;
  }

  async generateStoryWithAI(options: GenerateStoryOptions) {
    try {
      // Generate the story using Gemini
      const generatedStory = await this.geminiService.generateStory(options);

      // Generate audio for the story
      let audioUrl = '';
      if (generatedStory.content) {
        const { buffer, filename } = await this.elevenLabs.generateAudioBuffer(
          generatedStory.content,
        );
        audioUrl = await this.uploadService.uploadAudioBuffer(buffer, filename);
      }

      // Generate or get a cover image
      const coverImageUrl = await this.geminiService.generateStoryImage(
        generatedStory.title,
        generatedStory.description,
      );

      // Get theme and category IDs from names
      const themes = await this.prisma.theme.findMany({
        where: {
          name: { in: generatedStory.theme },
          isDeleted: false, // ONLY USE NON-DELETED THEMES
        },
      });
      const categories = await this.prisma.category.findMany({
        where: {
          name: { in: generatedStory.category },
          isDeleted: false, // ONLY USE NON-DELETED CATEGORIES
        },
      });

      // Save the story to the database
      const story = await this.prisma.story.create({
        data: {
          title: generatedStory.title,
          description: generatedStory.description,
          textContent: generatedStory.content,
          language: generatedStory.language,
          coverImageUrl,
          audioUrl,
          isInteractive: true,
          ageMin: generatedStory.ageMin,
          ageMax: generatedStory.ageMax,
          themes: {
            connect: themes.map((t: Theme) => ({ id: t.id })),
          },
          categories: {
            connect: categories.map((c: Category) => ({ id: c.id })),
          },
          questions: {
            create: generatedStory.questions.map((q) => ({
              question: q.question,
              options: q.options,
              correctOption: q.answer,
            })),
          },
          difficultyLevel: generatedStory.difficultyLevel || 1,
          wordCount: generatedStory.estimatedWordCount || 0,
          aiGenerated: true,
        },
        include: {
          themes: true,
          categories: true,
          questions: true,
        },
      });

      return story;
    } catch (error) {
      this.logger.error('Failed to generate story with AI:', error);
      throw error;
    }
  }

  async generateStoryForKid(
    kidId: string,
    themeNames?: string[],
    categoryNames?: string[],
  ) {
    // 1. Get kid's information, preferred categories, AND excluded tags
    const kid = await this.prisma.kid.findUnique({
      where: {
        id: kidId,
        isDeleted: false, // CANNOT GENERATE STORY FOR SOFT DELETED KIDS
      },
      include: { preferredCategories: true, ageGroup: true },
    });

    if (!kid) {
      throw new NotFoundException(`Kid with id ${kidId} not found`);
    }

    // Extract age from ageGroup
    let ageMin = 4;
    let ageMax = 8;
    if (kid.ageGroup) {
      ageMin = kid.ageGroup.min;
      ageMax = kid.ageGroup.max;
    }

    // 2. Prepare Themes
    let themes = themeNames || [];
    if (themes.length === 0) {
      const availableThemes = await this.prisma.theme.findMany({
        where: {
          isDeleted: false, // ONLY USE NON-DELETED THEMES
        },
      });
      const randomTheme =
        availableThemes[Math.floor(Math.random() * availableThemes.length)];
      themes = [randomTheme.name];
    }

    // 3. Prepare Categories (Merge Input + Preferences)
    let categories = categoryNames || [];

    if (kid.preferredCategories && kid.preferredCategories.length > 0) {
      const prefCategoryNames = kid.preferredCategories.map((c) => c.name);
      categories = [...new Set([...categories, ...prefCategoryNames])];
    }

    if (categories.length === 0) {
      const availableCategories = await this.prisma.category.findMany({
        where: {
          isDeleted: false, // ONLY USE NON-DELETED CATEGORIES
        },
      });
      const randomCategory =
        availableCategories[
          Math.floor(Math.random() * availableCategories.length)
        ];
      categories = [randomCategory.name];
    }

    // 4. Handle Excluded Tags
    let contextString = '';

    if (kid.excludedTags && kid.excludedTags.length > 0) {
      const exclusions = kid.excludedTags.join(', ');
      // We explicitly instruct the AI to avoid these
      contextString = `IMPORTANT: The story must strictly AVOID the following topics, themes, creatures, or elements: ${exclusions}. Ensure the content is safe and comfortable for the child regarding these exclusions.`;
    }

    // 5. Construct Options
    const options: GenerateStoryOptions = {
      theme: themes,
      category: categories,
      ageMin,
      ageMax,
      kidName: kid.name || 'Hero',
      language: 'English',
      additionalContext: contextString, // Pass the exclusion instruction here
    };

    this.logger.log(
      `Generating story for ${options.kidName}. Themes: [${themes.join(', ')}]. Exclusions: [${kid.excludedTags.join(', ')}]`,
    );

    return this.generateStoryWithAI(options);
  }

  private async adjustReadingLevel(
    kidId: string,
    storyId: string,
    totalTimeSeconds: number,
  ) {
    const story = await this.prisma.story.findUnique({
      where: {
        id: storyId,
        isDeleted: false, // CANNOT ADJUST LEVEL BASED ON SOFT DELETED STORIES
      },
    });
    const kid = await this.prisma.kid.findUnique({
      where: {
        id: kidId,
        isDeleted: false, // CANNOT ADJUST LEVEL FOR SOFT DELETED KIDS
      },
    });

    if (!story || !kid || story.wordCount === 0) return;

    // 1. Calculate Words Per Minute (WPM)
    const minutes = totalTimeSeconds / 60;
    const wpm = minutes > 0 ? story.wordCount / minutes : 0;

    // 2. Define Example logic - you can tweak these numbers
    // Age 6-8 avg WPM is ~50-90. Age 9-12 is ~100-140.

    let newLevel = kid.currentReadingLevel;

    // If they read very fast (>120 WPM) and the story was at their level
    if (wpm > 120 && story.difficultyLevel >= kid.currentReadingLevel) {
      newLevel = Math.min(10, kid.currentReadingLevel + 1); // Level Up!
    }
    // If they read very slowly (<40 WPM) and struggled
    else if (wpm < 40 && story.difficultyLevel >= kid.currentReadingLevel) {
      newLevel = Math.max(1, kid.currentReadingLevel - 1); // Level Down
    }

    if (newLevel !== kid.currentReadingLevel) {
      await this.prisma.kid.update({
        where: { id: kidId },
        data: { currentReadingLevel: newLevel },
      });
      this.logger.log(`Adjusted Kid ${kidId} reading level to ${newLevel}`);
    }
  }
}
