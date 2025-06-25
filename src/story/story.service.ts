import { Injectable } from '@nestjs/common';
import PrismaService from '../prisma/prisma.service';
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
} from './story.dto';
import { ElevenLabsService } from './elevenlabs.service';
import { UploadService } from '../upload/upload.service';
import { Prisma, Voice } from '@prisma/client';

@Injectable()
export class StoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly elevenLabs: ElevenLabsService,
    public readonly uploadService: UploadService,
  ) {}

  async getStories(filter: {
    theme?: string;
    category?: string;
    recommended?: boolean;
  }) {
    const where: any = {};
    if (filter.theme) where.theme = filter.theme;
    if (filter.category) where.category = filter.category;
    if (filter.recommended !== undefined)
      where.recommended = filter.recommended;
    return this.prisma.story.findMany({
      where,
      include: { images: true, branches: true },
    });
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
    return this.prisma.story.create({
      data: {
        ...data,
        audioUrl,
        coverImageUrl: data.coverImageUrl ?? '',
        isInteractive: data.isInteractive ?? false,
        ageMin: data.ageMin ?? 0,
        ageMax: data.ageMax ?? 0,
        images: data.images ? { create: data.images } : undefined,
        branches: data.branches ? { create: data.branches } : undefined,
      },
      include: { images: true, branches: true },
    });
  }

  async updateStory(id: string, data: UpdateStoryDto) {
    let audioUrl = data.audioUrl;
    if (!audioUrl && data.description) {
      const { buffer, filename } = await this.elevenLabs.generateAudioBuffer(
        data.description,
      );
      audioUrl = await this.uploadService.uploadAudioBuffer(buffer, filename);
    }
    // Only update scalar fields; images/branches should be managed via their own endpoints
    const {
      title,
      description,
      language,
      theme,
      category,
      coverImageUrl,
      isInteractive,
      ageMin,
      ageMax,
    } = data;
    return this.prisma.story.update({
      where: { id },
      data: {
        title,
        description,
        language,
        theme,
        category,
        coverImageUrl,
        isInteractive,
        ageMin,
        ageMax,
        audioUrl,
      },
      include: { images: true, branches: true },
    });
  }

  async deleteStory(id: string) {
    return this.prisma.story.delete({ where: { id } });
  }

  // --- Images ---
  async addImage(storyId: string, image: StoryImageDto) {
    return this.prisma.storyImage.create({
      data: { ...image, storyId },
    });
  }

  // --- Branches ---
  async addBranch(storyId: string, branch: StoryBranchDto) {
    return this.prisma.storyBranch.create({
      data: { ...branch, storyId },
    });
  }

  // --- Favorites ---
  async addFavorite(userId: string, dto: FavoriteDto) {
    return this.prisma.favorite.create({
      data: { userId, storyId: dto.storyId },
    });
  }
  async removeFavorite(userId: string, storyId: string) {
    return this.prisma.favorite.deleteMany({
      where: { userId, storyId },
    });
  }
  async getFavorites(userId: string) {
    return this.prisma.favorite.findMany({
      where: { userId },
      include: { story: true },
    });
  }

  // --- Progress ---
  async setProgress(userId: string, dto: StoryProgressDto) {
    return this.prisma.storyProgress.upsert({
      where: { userId_storyId: { userId, storyId: dto.storyId } },
      update: {
        progress: dto.progress,
        completed: dto.completed ?? false,
        lastAccessed: new Date(),
      },
      create: {
        userId,
        storyId: dto.storyId,
        progress: dto.progress,
        completed: dto.completed ?? false,
      },
    });
  }
  async getProgress(userId: string, storyId: string) {
    return this.prisma.storyProgress.findUnique({
      where: { userId_storyId: { userId, storyId } },
    });
  }

  // --- Daily Challenge ---
  async setDailyChallenge(dto: DailyChallengeDto) {
    return this.prisma.dailyChallenge.create({ data: dto });
  }
  async getDailyChallenge(date: string) {
    return this.prisma.dailyChallenge.findMany({
      where: { challengeDate: new Date(date) },
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
    const assignments = await this.prisma.dailyChallengeAssignment.findMany({
      where: { kidId },
    });
    return assignments.map((a) => this.toDailyChallengeAssignmentDto(a));
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
    const voices = await this.prisma.voice.findMany({ where: { userId } });
    return voices.map((v) => this.toVoiceResponse(v));
  }

  async setPreferredVoice(
    userId: string,
    dto: SetPreferredVoiceDto,
  ): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { preferredVoiceId: dto.voiceId },
    });
  }

  async getPreferredVoice(userId: string): Promise<VoiceResponseDto | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { preferredVoice: true } as Prisma.UserInclude,
    });
    if (!user || !user.preferredVoice) return null;
    return this.toVoiceResponse(user.preferredVoice);
  }

  private toVoiceResponse(voice: Voice): VoiceResponseDto {
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
      where: { id: userId },
      include: { preferredVoice: true } as Prisma.UserInclude,
    });
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

  // Stub for Eleven Labs integration
  // async generateAudio(text: string): Promise<string> {
  //   // Call Eleven Labs API and return audio URL
  //   return 'https://elevenlabs.example/audio.mp3';
  // }

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
    const paths = await this.prisma.storyPath.findMany({ where: { kidId } });
    return paths.map((p) => this.toStoryPathDto(p));
  }

  async getStoryPathById(id: string): Promise<StoryPathDto | null> {
    const path = await this.prisma.storyPath.findUnique({ where: { id } });
    return path ? this.toStoryPathDto(path) : null;
  }

  async fetchAvailableVoices(): Promise<any[]> {
    return this.elevenLabs.fetchAvailableVoices();
  }
}
