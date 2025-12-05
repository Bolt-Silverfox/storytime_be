import { PrismaService } from '../prisma/prisma.service';
import {
  CreateStoryDto,
  UpdateStoryDto,
  StoryImageDto,
  StoryBranchDto,
  FavoriteDto,
  StoryProgressDto,
  DailyChallengeDto,
  AssignDailyChallengeDto,
  CompleteDailyChallengeDto,
  DailyChallengeAssignmentDto,
  StartStoryPathDto,
  UpdateStoryPathDto,
  StoryPathDto,
  CategoryDto,
  ThemeDto,
  PaginatedStoriesDto,
} from './story.dto';
import {
  UploadVoiceDto,
  CreateElevenLabsVoiceDto,
  SetPreferredVoiceDto,
  VoiceResponseDto,
} from '../voice/voice.dto';
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
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { GeminiService, GenerateStoryOptions } from './gemini.service';
import { Cache, CACHE_MANAGER } from '@nestjs/cache-manager';
import { VoiceType } from '../voice/voice.dto';

@Injectable()
export class StoryService {
  private readonly logger = new Logger(StoryService.name);
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    public readonly uploadService: UploadService,
    private readonly textToSpeechService: TextToSpeechService,
    private readonly geminiService: GeminiService,
  ) { }

  async getStories(filter: {
    theme?: string;
    category?: string;
    recommended?: boolean;
    age?: number;
    kidId?: string;
    page?: number;
    limit?: number;
  }): Promise<PaginatedStoriesDto> {
    const page = filter.page || 1;
    const limit = filter.limit || 12;
    const skip = (page - 1) * limit;

    const where: any = {
      isDeleted: false,
    };

    // 1. Apply basic manual filters
    if (filter.theme) where.themes = { some: { id: filter.theme } };

    // If a manual category is requested, prioritize it
    if (filter.category) {
      where.categories = { some: { id: filter.category } };
    }

    // 2. Initial "Recommended" Handling
    if (filter.recommended !== undefined && !filter.kidId) {
      where.recommended = filter.recommended;
    }

    let targetLevel: number | undefined;

    // 3. Kid-Specific Filtering Logic
    if (filter.kidId) {
      const kid = await this.prisma.kid.findUnique({
        where: {
          id: filter.kidId,
          isDeleted: false,
        },
        include: { preferredCategories: true },
      });

      if (kid) {
        // --- A. Age / Reading Level Logic ---
        // This ensures "filter based on the age of the child" happens regardless of preferences
        if (kid.currentReadingLevel > 0) {
          targetLevel = kid.currentReadingLevel;
          // Let learning be around +/- 1 level
          where.difficultyLevel = {
            gte: Math.max(1, targetLevel - 1),
            lte: targetLevel + 1,
          };
        } else if (kid.ageRange) {
          // Fallback to Age Range string parsing (e.g. "6-8")
          const match = kid.ageRange.match(/(\d+)/);
          if (match) {
            const age = parseInt(match[1], 10);
            where.ageMin = { lte: age };
            where.ageMax = { gte: age };
          }
        }

        // --- B. Recommended + Preference Logic ---
        if (filter.recommended === true) {
          // We are now defining "Recommended" as "Personalized for this Kid"
          delete where.recommended;

          // Only apply category preference filter IF:
          // 1. No manual category was selected in the UI (filter.category is undefined)
          // 2. The kid actually has preferences
          if (!filter.category && kid.preferredCategories.length > 0) {
            const categoryIds = kid.preferredCategories.map((c) => c.id);

            // Add AND condition: Must be in preferred categories
            where.categories = {
              some: {
                id: { in: categoryIds },
              },
            };
          }
          // If (!filter.category && kid.preferredCategories.length === 0),
          // we do nothing here. The 'where' clause already contains the Age/Level logic
          // from Step A, so it simply returns "Age Appropriate" stories.
        }
      }
    }

    // 4. Manual Age Filter Fallback
    if (filter.age && !targetLevel && !where.ageMin) {
      where.ageMin = { lte: filter.age };
      where.ageMax = { gte: filter.age };
    }

    const totalCount = await this.prisma.story.count({ where });
    const totalPages = Math.ceil(totalCount / limit);

    const stories = await this.prisma.story.findMany({
      where,
      skip,
      take: limit,
      include: {
        images: true,
        branches: true,
        categories: true,
        themes: true,
        questions: true,
      },
    });

    return {
      data: stories,
      pagination: {
        currentPage: page,
        totalPages,
        pageSize: limit,
        totalCount,
      },
    };
  }

  async createStory(data: CreateStoryDto) {
    if (data.categoryIds && data.categoryIds.length > 0) {
      const categories = await this.prisma.category.findMany({
        where: { id: { in: data.categoryIds } },
      });
      if (categories.length !== data.categoryIds.length) {
        throw new BadRequestException('One or more categories not found');
      }
    }

    // Generate audio URL if not provided but text content exists
    let audioUrl = data.audioUrl;
    // Note: We can't easily generate audio here without an ID, so we might need to do it after creation or let the client request it.
    // For now, we'll leave it as is from the DTO.

    const story = await this.prisma.story.create({
      data: {
        title: data.title,
        description: data.description,
        language: data.language,
        coverImageUrl: data.coverImageUrl ?? '',
        audioUrl: audioUrl ?? '',
        isInteractive: data.isInteractive ?? false,
        ageMin: data.ageMin ?? 0,
        ageMax: data.ageMax ?? 9,
        images: data.images ? { create: data.images } : undefined,
        branches: data.branches ? { create: data.branches } : undefined,
        categories: data.categoryIds ? { connect: data.categoryIds.map((id) => ({ id })) } : undefined,
        themes: data.themeIds ? { connect: data.themeIds.map((id) => ({ id })) } : undefined,
      },
      include: { images: true, branches: true },
    });

    await this.cacheManager.del('categories:all');
    this.logger.log('Categories cache invalidated after story creation');

    return story;
  }

  async updateStory(id: string, data: UpdateStoryDto) {
    const story = await this.prisma.story.findUnique({
      where: { id, isDeleted: false },
    });

    if (!story) {
      throw new NotFoundException('Story not found');
    }

    if (data.categoryIds && data.categoryIds.length > 0) {
      const categories = await this.prisma.category.findMany({
        where: { id: { in: data.categoryIds } },
      });

      if (categories.length !== data.categoryIds.length) {
        throw new BadRequestException('One or more categories not found');
      }
    }

    const updatedStory = await this.prisma.story.update({
      where: { id },
      data: {
        title: data.title,
        description: data.description,
        language: data.language,
        coverImageUrl: data.coverImageUrl,
        isInteractive: data.isInteractive,
        ageMin: data.ageMin,
        ageMax: data.ageMax,
        audioUrl: data.audioUrl,
        images: data.images ? { create: data.images } : undefined,
        branches: data.branches ? { create: data.branches } : undefined,
        categories: data.categoryIds
          ? { set: data.categoryIds.map((id) => ({ id })) }
          : undefined,
        themes: data.themeIds
          ? { set: data.themeIds.map((id) => ({ id })) }
          : undefined,
      },
      include: { images: true, branches: true },
    });

    await this.cacheManager.del('categories:all');
    this.logger.log('Categories cache invalidated after story update');

    return updatedStory;
  }

  async deleteStory(id: string, permanent: boolean = false) {
    const story = await this.prisma.story.findUnique({
      where: {
        id,
        isDeleted: false
      }
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
          deletedAt: new Date()
        },
      });
    }
  }

  async undoDeleteStory(id: string) {
    const story = await this.prisma.story.findUnique({
      where: { id }
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
        deletedAt: null
      },
    });
  }

  // --- Images ---
  async addImage(storyId: string, image: StoryImageDto) {
    const story = await this.prisma.story.findUnique({
      where: {
        id: storyId,
        isDeleted: false
      }
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
        isDeleted: false
      }
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
    const kid = await this.prisma.kid.findUnique({
      where: {
        id: dto.kidId,
        isDeleted: false
      }
    });

    if (!kid) {
      throw new NotFoundException('Kid not found');
    }

    const story = await this.prisma.story.findUnique({
      where: {
        id: dto.storyId,
        isDeleted: false
      }
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
        isDeleted: false
      }
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
    const kid = await this.prisma.kid.findUnique({
      where: {
        id: dto.kidId,
        isDeleted: false
      }
    });

    if (!kid) {
      throw new NotFoundException('Kid not found');
    }

    const story = await this.prisma.story.findUnique({
      where: {
        id: dto.storyId,
        isDeleted: false
      }
    });

    if (!story) {
      throw new NotFoundException('Story not found');
    }

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

    if (dto.completed && (!existing || !existing.completed)) {
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
        isDeleted: false
      }
    });

    if (!kid) {
      throw new NotFoundException('Kid not found');
    }

    const story = await this.prisma.story.findUnique({
      where: {
        id: storyId,
        isDeleted: false
      }
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
        isDeleted: false
      }
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
        isDeleted: false
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
    const kid = await this.prisma.kid.findUnique({
      where: {
        id: dto.kidId,
        isDeleted: false
      }
    });

    if (!kid) {
      throw new NotFoundException('Kid not found');
    }

    const challenge = await this.prisma.dailyChallenge.findUnique({
      where: {
        id: dto.challengeId,
        isDeleted: false
      }
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
        isDeleted: false
      }
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
        isDeleted: false
      }
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
        isDeleted: false
      }
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
        isDeleted: false
      }
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const voices = await this.prisma.voice.findMany({
      where: {
        userId,
        isDeleted: false
      }
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
        isDeleted: false
      }
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (dto.voiceId) {
      const voice = await this.prisma.voice.findUnique({
        where: {
          id: dto.voiceId,
          isDeleted: false
        }
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
        isDeleted: false
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

  async getStoryAudioUrl(
    storyId: string,
    voiceType: VoiceType,
  ): Promise<string> {
    const story = await this.prisma.story.findUnique({
      where: {
        id: storyId,
        isDeleted: false
      },
      select: { textContent: true },
    });
    if (!story) {
      throw new NotFoundException(`Story with ID ${storyId} not found`);
    }

    const cachedAudio = await this.prisma.storyAudioCache.findFirst({
      where: { storyId, voiceType },
    });
    if (cachedAudio) {
      return cachedAudio.audioUrl;
    }

    const audioUrl = await this.textToSpeechService.textToSpeechCloudUrl(
      storyId,
      story?.textContent ?? '',
      voiceType,
    );

    await this.prisma.storyAudioCache.create({
      data: {
        storyId,
        voiceType,
        audioUrl,
      },
    });

    return audioUrl;
  }

  private toStoryPathDto(path: any): StoryPathDto {
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
    const kid = await this.prisma.kid.findUnique({
      where: {
        id: dto.kidId,
        isDeleted: false
      }
    });

    if (!kid) {
      throw new NotFoundException('Kid not found');
    }

    const story = await this.prisma.story.findUnique({
      where: {
        id: dto.storyId,
        isDeleted: false
      }
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
        isDeleted: false
      }
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
    // Return the configured voices from VOICE_CONFIG
    return Object.keys(VoiceType).map((key) => ({
      voice_id: key,
      name: key,
    }));
  }

  async getCategories(): Promise<CategoryDto[]> {
    this.logger.log('Fetching categories with story counts from database');

    const categories = await this.prisma.category.findMany({
      where: {
        isDeleted: false,
      },
      include: {
        _count: {
          select: { stories: true },
        },
      },
    });

    return categories.map((c) => ({
      id: c.id,
      name: c.name,
      image: c.image ?? undefined,
      description: c.description ?? undefined,
      storyCount: c._count.stories,
    }));
  }

  async getThemes(): Promise<ThemeDto[]> {
    const themes = await this.prisma.theme.findMany({
      where: {
        isDeleted: false,
      }
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
    today.setHours(0, 0, 0, 0);

    const kids = await this.prisma.kid.findMany({
      where: {
        isDeleted: false,
      }
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
        (s: any) => !usedStoryIds.has(s.id),
      );
      const storyPool =
        availableStories.length > 0 ? availableStories : stories;
      const story = storyPool[Math.floor(Math.random() * storyPool.length)];

      const wordOfTheDay = story.title;
      const meaning =
        story.description.split('. ')[0] +
        (story.description.includes('.') ? '.' : '');

      let challenge = await this.prisma.dailyChallenge.findFirst({
        where: {
          storyId: story.id,
          challengeDate: today,
          isDeleted: false,
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
        isDeleted: false
      }
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
          isDeleted: false,
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

  async getWeeklyDailyChallengeAssignments(kidId: string, weekStart: Date) {
    const kid = await this.prisma.kid.findUnique({
      where: {
        id: kidId,
        isDeleted: false
      }
    });

    if (!kid) {
      throw new NotFoundException('Kid not found');
    }

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7);
    const assignments = await this.prisma.dailyChallengeAssignment.findMany({
      where: {
        kidId,
        challenge: {
          challengeDate: {
            gte: weekStart,
            lt: weekEnd,
          },
          isDeleted: false,
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
      where: { id, isDeleted: false },
      include: {
        images: true,
        branches: true,
        categories: true,
        themes: true,
        questions: true,
      },
    });

    if (!story) {
      throw new NotFoundException('Story not found');
    }
    return story;
  }

  async generateStoryWithAI(options: GenerateStoryOptions) {
    return this.geminiService.generateStory(options);
  }

  async generateStoryForKid(
    kidId: string,
    themeNames?: string[],
    categoryNames?: string[],
    kidName?: string,
  ) {
    const kid = await this.prisma.kid.findUnique({
      where: {
        id: kidId,
        isDeleted: false
      },
      include: { preferredCategories: true, preferredVoice: true },
    });

    if (!kid) {
      throw new NotFoundException(`Kid with id ${kidId} not found`);
    }

    let ageMin = 4;
    let ageMax = 8;
    if (kid.ageRange && typeof kid.ageRange === 'string') {
      const match = kid.ageRange.match(/(\d+)-?(\d+)?/);
      if (match) {
        ageMin = parseInt(match[1], 10);
        ageMax = match[2] ? parseInt(match[2], 10) : ageMin + 2;
      }
    }

    let themes = themeNames || [];
    if (themes.length === 0) {
      const availableThemes = await this.prisma.theme.findMany({
        where: {
          isDeleted: false,
        }
      });
      const randomTheme =
        availableThemes[Math.floor(Math.random() * availableThemes.length)];
      themes = [randomTheme.name];
    }

    let categories = categoryNames || [];

    if (kid.preferredCategories && kid.preferredCategories.length > 0) {
      const prefCategoryNames = kid.preferredCategories.map((c) => c.name);
      categories = [...new Set([...categories, ...prefCategoryNames])];
    }

    if (categories.length === 0) {
      const availableCategories = await this.prisma.category.findMany({
        where: {
          isDeleted: false,
        }
      });
      const randomCategory =
        availableCategories[
        Math.floor(Math.random() * availableCategories.length)
        ];
      categories = [randomCategory.name];
    }

    let contextString = '';

    if (kid.excludedTags && kid.excludedTags.length > 0) {
      const exclusions = kid.excludedTags.join(', ');
      contextString = `IMPORTANT: The story must strictly AVOID the following topics, themes, creatures, or elements: ${exclusions}. Ensure the content is safe and comfortable for the child regarding these exclusions.`;
    }

    let voiceType: VoiceType | undefined;
    if (kid.preferredVoice) {
      // Check if the voice name matches a VoiceType key
      const voiceName = kid.preferredVoice.name.toUpperCase();
      if (voiceName in VoiceType) {
        voiceType = VoiceType[voiceName as keyof typeof VoiceType];
      } else if (kid.preferredVoice.elevenLabsVoiceId) {
        // Check if elevenLabsVoiceId matches a VoiceType key (e.g. "MILO")
        const elId = kid.preferredVoice.elevenLabsVoiceId.toUpperCase();
        if (elId in VoiceType) {
          voiceType = VoiceType[elId as keyof typeof VoiceType];
        }
      }
    }

    const options: GenerateStoryOptions = {
      theme: themes,
      category: categories,
      ageMin,
      ageMax,
      kidName: kidName || kid.name || 'Hero',
      language: 'English',
      additionalContext: contextString,
      creatorKidId: kidId,
      voiceType,
    };

    this.logger.log(
      `Generating story for ${options.kidName}. Themes: [${themes.join(', ')}]. Exclusions: [${kid.excludedTags.join(', ')}]`
    );

    return this.geminiService.generateStory(options);
  }

  private async adjustReadingLevel(
    kidId: string,
    storyId: string,
    totalTimeSeconds: number,
  ) {
    const story = await this.prisma.story.findUnique({
      where: {
        id: storyId,
        isDeleted: false
      },
    });
    const kid = await this.prisma.kid.findUnique({
      where: {
        id: kidId,
        isDeleted: false
      }
    });

    if (!story || !kid || story.wordCount === 0) return;

    const minutes = totalTimeSeconds / 60;
    const wpm = minutes > 0 ? story.wordCount / minutes : 0;

    let newLevel = kid.currentReadingLevel;

    if (wpm > 120 && story.difficultyLevel >= kid.currentReadingLevel) {
      newLevel = Math.min(10, kid.currentReadingLevel + 1);
    }
    else if (wpm < 40 && story.difficultyLevel >= kid.currentReadingLevel) {
      newLevel = Math.max(1, kid.currentReadingLevel - 1);
    }

    if (newLevel !== kid.currentReadingLevel) {
      await this.prisma.kid.update({
        where: { id: kidId },
        data: { currentReadingLevel: newLevel },
      });
      this.logger.log(`Adjusted Kid ${kidId} reading level to ${newLevel}`);
    }
  }

  //------ Library service methods--------------------

  // 1. GET CONTINUE READING (In Progress)
  async getContinueReading(kidId: string) {
    // Fetch progress where progress > 0 but NOT completed
    const progressRecords = await this.prisma.storyProgress.findMany({
      where: {
        kidId,
        progress: { gt: 0 },
        completed: false,
        isDeleted: false,
      },
      orderBy: { lastAccessed: 'desc' },
      include: { story: true },
    });

    // Transform to return just the stories with their progress attached
    return progressRecords.map((record) => ({
      ...record.story,
      progress: record.progress,
      totalTimeSpent: record.totalTimeSpent,
      lastAccessed: record.lastAccessed,
    }));
  }

  // 2. GET COMPLETED STORIES (History)
  async getCompletedStories(kidId: string) {
    const records = await this.prisma.storyProgress.findMany({
      where: {
        kidId,
        completed: true,
        isDeleted: false,
      },
      orderBy: { lastAccessed: 'desc' },
      include: { story: true },
    });
    return records.map(r => r.story);
  }

  // 3. GET MY CREATIONS (AI Stories generated by this kid)
  async getCreatedStories(kidId: string) {
    return await this.prisma.story.findMany({
      where: {
        creatorKidId: kidId,
        isDeleted: false,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // 4. GET DOWNLOADS
  async getDownloads(kidId: string) {
    const downloads = await this.prisma.downloadedStory.findMany({
      where: { kidId },
      include: { story: true },
      orderBy: { downloadedAt: 'desc' },
    });
    return downloads.map((d) => d.story);
  }

  // 5. ADD DOWNLOAD
  async addDownload(kidId: string, storyId: string) {
    const story = await this.prisma.story.findUnique({ where: { id: storyId } });
    if (!story) throw new NotFoundException('Story not found');

    return await this.prisma.downloadedStory.upsert({
      where: {
        kidId_storyId: { kidId, storyId },
      },
      create: { kidId, storyId },
      update: { downloadedAt: new Date() },
    });
  }

  // 6. REMOVE DOWNLOAD
  async removeDownload(kidId: string, storyId: string) {
    try {
      return await this.prisma.downloadedStory.delete({
        where: {
          kidId_storyId: { kidId, storyId },
        },
      });
    } catch (error) {
      return { message: 'Download removed' };
    }
  }

  // 7. REMOVE FROM LIBRARY (The "Reset" Button)
  // This removes it from Favorites, Downloads, and resets Progress
  async removeFromLibrary(kidId: string, storyId: string) {
    return await this.prisma.$transaction([
      // 1. Remove from Favorites
      this.prisma.favorite.deleteMany({
        where: { kidId, storyId },
      }),
      // 2. Remove from Downloads
      this.prisma.downloadedStory.deleteMany({
        where: { kidId, storyId },
      }),
      // 3. Reset Progress (Hard delete the progress record)
      this.prisma.storyProgress.deleteMany({
        where: { kidId, storyId },
      }),
    ]);
  }
}