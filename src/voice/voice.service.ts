import { Injectable } from '@nestjs/common';
import {
  CreateElevenLabsVoiceDto,
  SetPreferredVoiceDto,
  UploadVoiceDto,
  VoiceResponseDto,
} from './dto/voice.dto';
import { VoiceLibraryService } from './services/voice-library.service';
import { VoicePreferenceService } from './services/voice-preference.service';
import { VoiceCatalogService } from './services/voice-catalog.service';

/**
 * Thin facade over the voice-management concerns. Delegates to focused
 * services so existing injectors (VoiceController, KidService) keep the
 * same public surface:
 *
 * - {@link VoiceLibraryService}    — user voice CRUD + ElevenLabs import
 * - {@link VoicePreferenceService} — preferred/default voice selection
 * - {@link VoiceCatalogService}    — config-driven system voice catalog
 */
@Injectable()
export class VoiceService {
  constructor(
    private readonly library: VoiceLibraryService,
    private readonly preference: VoicePreferenceService,
    private readonly catalog: VoiceCatalogService,
  ) {}

  // --- Upload a new voice file ---
  uploadVoice(
    userId: string,
    fileUrl: string,
    dto: UploadVoiceDto,
    fileBuffer?: Buffer,
  ): Promise<VoiceResponseDto> {
    return this.library.uploadVoice(userId, fileUrl, dto, fileBuffer);
  }

  // --- Create a voice using ElevenLabs ID ---
  createElevenLabsVoice(
    userId: string,
    dto: CreateElevenLabsVoiceDto,
  ): Promise<VoiceResponseDto> {
    return this.library.createElevenLabsVoice(userId, dto);
  }

  // --- List all voices for a user ---
  listVoices(userId: string): Promise<VoiceResponseDto[]> {
    return this.library.listVoices(userId);
  }

  // --- Set preferred voice for a user (Parent) ---
  setPreferredVoice(
    userId: string,
    dto: SetPreferredVoiceDto,
  ): Promise<VoiceResponseDto> {
    return this.preference.setPreferredVoice(userId, dto);
  }

  // --- Get the preferred voice for a user ---
  getPreferredVoice(userId: string): Promise<VoiceResponseDto> {
    return this.preference.getPreferredVoice(userId);
  }

  findOrCreateElevenLabsVoice(
    elevenLabsId: string,
    userId: string,
  ): Promise<{ id: string }> {
    return this.library.findOrCreateElevenLabsVoice(elevenLabsId, userId);
  }

  // --- Fetch available system voices (cached) ---
  fetchAvailableVoices(): Promise<VoiceResponseDto[]> {
    return this.catalog.fetchAvailableVoices();
  }
}
