import {
  Injectable,
  Inject,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { CreateKidDto, UpdateKidDto } from './dto/kid.dto';
import { VoiceService } from '../voice/voice.service';
import {
  IKidRepository,
  KID_REPOSITORY,
  KidWithRelations,
} from './repositories';

@Injectable()
export class KidService {
  constructor(
    @Inject(KID_REPOSITORY)
    private readonly kidRepository: IKidRepository,
    private voiceService: VoiceService,
  ) {}

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
    return this.transformKid(kid);
  }

  async findAllByUser(userId: string) {
    const kids = await this.kidRepository.findAllByParentId(userId);

    // Map every kid through the transformer
    return kids.map((k: KidWithRelations) => this.transformKid(k));
  }

  async findOne(kidId: string, userId: string) {
    const kid = await this.kidRepository.findByIdWithFullRelations(kidId);

    if (!kid) throw new NotFoundException('Kid not found');
    if (kid.parentId !== userId) throw new ForbiddenException('Access denied');

    // Get recommendation stats
    const totalRecommendations = await this.kidRepository.countParentRecommendations(kidId);

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

    if (permanent) {
      return this.kidRepository.hardDelete(kidId);
    } else {
      return this.kidRepository.softDelete(kidId);
    }
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

    return this.kidRepository.restore(kidId);
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

    // Fetch them back to return full structures
    return this.findAllByUser(userId);
  }
}
