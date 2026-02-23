import {
  Injectable,
  Inject,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CreateKidDto, UpdateKidDto } from './dto/kid.dto';
import { VoiceService } from '../voice/voice.service';
import {
  IKidRepository,
  KID_REPOSITORY,
  KidWithRelations,
} from './repositories';
import {
  CACHE_KEYS,
  CACHE_TTL_MS,
} from '@/shared/constants/cache-keys.constants';
import { AppEvents, KidCreatedEvent, KidDeletedEvent } from '@/shared/events';

@Injectable()
export class KidService {
  constructor(
    @Inject(KID_REPOSITORY)
    private readonly kidRepository: IKidRepository,
    private voiceService: VoiceService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Invalidate kid-related caches
   */
  private async invalidateKidCaches(
    kidId: string,
    userId: string,
  ): Promise<void> {
    await Promise.all([
      this.cacheManager.del(CACHE_KEYS.KID_PROFILE(kidId)),
      this.cacheManager.del(CACHE_KEYS.USER_KIDS(userId)),
    ]);
  }

  // --- HELPER: Transforms the DB response for the Frontend ---
  // This ensures preferredVoiceId is ALWAYS the ElevenLabs ID (if available) (frontend specified smh)
  private transformKid(kid: KidWithRelations | null) {
    if (!kid) return null;

    let finalVoiceId = kid.preferredVoiceId;

    // If we have the relation loaded, use the real ElevenLabs ID instead of our DB UUID
    if (kid.preferredVoice && kid.preferredVoice.elevenLabsVoiceId) {
      finalVoiceId = kid.preferredVoice.elevenLabsVoiceId;
    }

    return {
      ...kid,
      preferredVoiceId: finalVoiceId,
      // We keep the preferredVoice object too, in case they need the name/url
    };
  }

  async createKid(userId: string, dto: CreateKidDto) {
    const { preferredCategoryIds, avatarId, ...data } = dto;

    const kid = await this.kidRepository.create({
      ...data,
      parentId: userId,
      avatarId,
      preferredCategoryIds,
    });

    // Emit kid created event (cache invalidation handled by KidCacheListener)
    this.eventEmitter.emit(AppEvents.KID_CREATED, {
      kidId: kid.id,
      parentId: userId,
      name: kid.name,
      ageRange: kid.ageRange,
      createdAt: kid.createdAt,
    } satisfies KidCreatedEvent);

    return this.transformKid(kid);
  }

  /**
   * Get all kids for a user
   * Uses caching for improved performance (5-minute TTL)
   */
  async findAllByUser(userId: string) {
    // Check cache first
    const cacheKey = CACHE_KEYS.USER_KIDS(userId);
    const cached = await this.cacheManager.get(cacheKey);
    if (cached) {
      return cached;
    }

    const kids = await this.kidRepository.findAllByParentId(userId);

    // Map every kid through the transformer
    const result = kids.map((k: KidWithRelations) => this.transformKid(k));

    // Cache for 5 minutes
    await this.cacheManager.set(cacheKey, result, CACHE_TTL_MS.USER_DATA);

    return result;
  }

  async findOne(kidId: string, userId: string) {
    const kid = await this.kidRepository.findByIdWithFullRelations(kidId);

    if (!kid) throw new NotFoundException('Kid not found');
    if (kid.parentId !== userId) throw new ForbiddenException('Access denied');

    // Get recommendation stats
    const totalRecommendations =
      await this.kidRepository.countParentRecommendations(kidId);

    const transformedKid = this.transformKid(kid);

    // Add recommendation stats to the response
    return {
      ...transformedKid,
      recommendationStats: {
        total: totalRecommendations,
      },
    };
  }

  async updateKid(kidId: string, userId: string, dto: UpdateKidDto) {
    // 1. Verify ownership and check if not soft deleted
    const kid = await this.kidRepository.findByIdNotDeleted(kidId);
    if (!kid || kid.parentId !== userId) {
      throw new NotFoundException('Kid not found or access denied');
    }

    const { preferredCategoryIds, preferredVoiceId, avatarId, ...rest } = dto;

    // 2. Resolve Voice ID (Supports both UUID and ElevenLabs ID input)
    let finalVoiceId: string | undefined = undefined;

    if (preferredVoiceId) {
      // Check if input is a UUID (Internal DB ID)
      const isUuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          preferredVoiceId,
        );

      if (isUuid) {
        const voice = await this.kidRepository.findVoiceById(preferredVoiceId);
        if (!voice) throw new NotFoundException('Voice not found');
        finalVoiceId = voice.id;
      } else {
        // If not UUID, assume it's ElevenLabs ID and find/create it
        const voice = await this.voiceService.findOrCreateElevenLabsVoice(
          preferredVoiceId,
          userId,
        );
        finalVoiceId = voice.id;
      }
    }

    // 3. Update the Kid
    const updatedKid = await this.kidRepository.update(kidId, {
      ...rest,
      avatarId,
      preferredCategoryIds,
      preferredVoiceId: finalVoiceId,
    });

    // Invalidate caches after update
    await this.invalidateKidCaches(kidId, userId);

    return this.transformKid(updatedKid);
  }

  /**
   * Soft delete or permanently delete a kid
   * @param kidId Kid ID
   * @param userId User ID for verification
   * @param permanent Whether to permanently delete (default: false)
   */
  async deleteKid(kidId: string, userId: string, permanent: boolean = false) {
    const kid = await this.kidRepository.findByIdNotDeleted(kidId);
    if (!kid || kid.parentId !== userId) {
      throw new NotFoundException('Kid not found or access denied');
    }

    let result;
    if (permanent) {
      result = await this.kidRepository.hardDelete(kidId);
    } else {
      result = await this.kidRepository.softDelete(kidId);
    }

    // Emit kid deleted event (cache invalidation handled by KidCacheListener)
    this.eventEmitter.emit(AppEvents.KID_DELETED, {
      kidId: kid.id,
      parentId: userId,
      deletedAt: new Date(),
    } satisfies KidDeletedEvent);

    return result;
  }

  /**
   * Restore a soft deleted kid
   * @param kidId Kid ID
   * @param userId User ID for verification
   */
  async undoDeleteKid(kidId: string, userId: string) {
    const kid = await this.kidRepository.findById(kidId);
    if (!kid) throw new NotFoundException('Kid not found');
    if (kid.parentId !== userId) throw new ForbiddenException('Access denied');
    if (!kid.isDeleted) throw new BadRequestException('Kid is not deleted');

    const restoredKid = await this.kidRepository.restore(kidId);

    // Invalidate caches after restoration
    await this.invalidateKidCaches(kidId, userId);

    return restoredKid;
  }

  async createKids(userId: string, dtos: CreateKidDto[]) {
    const parent = await this.kidRepository.findUserByIdNotDeleted(userId);
    if (!parent) throw new NotFoundException('Parent User not found');

    // Execute creates in transaction
    const kidData = dtos.map((dto) => {
      const { preferredCategoryIds, avatarId, ...data } = dto;
      return {
        ...data,
        parentId: userId,
        avatarId,
        preferredCategoryIds,
      };
    });

    await this.kidRepository.createMany(userId, kidData);

    // Invalidate user's kids cache after bulk creation
    await this.cacheManager.del(CACHE_KEYS.USER_KIDS(userId));

    // Fetch them back to return full structures
    return this.findAllByUser(userId);
  }
}
