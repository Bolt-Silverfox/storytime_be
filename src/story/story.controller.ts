import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Logger,
  DefaultValuePipe,
  ParseIntPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiQuery,
  ApiParam,
  ApiBody,
  ApiBearerAuth,
  ApiResponse,
  ApiOkResponse,
} from '@nestjs/swagger';
import { StoryService } from './story.service';
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
  ErrorResponseDto,
  VoiceType,
  StoryContentAudioDto,
  GenerateStoryDto,
  PaginatedStoriesDto,
} from './story.dto';
import { AuthSessionGuard, AuthenticatedRequest } from '../auth/auth.guard';
import { FileInterceptor } from '@nestjs/platform-express';
import { TextToSpeechService } from './text-to-speech.service';
import { randomUUID } from 'crypto';
import { CacheInterceptor, CacheKey, CacheTTL } from '@nestjs/cache-manager';

@ApiTags('stories')
@Controller('stories')
export class StoryController {
  private readonly logger = new Logger(StoryController.name);
  constructor(
    private readonly storyService: StoryService,
    private readonly textToSpeechService: TextToSpeechService,
  ) {}

  @Get()
  @UseInterceptors(CacheInterceptor)
  @CacheKey('categories:all')
  @CacheTTL(4 * 60 * 60 * 1000)
  @ApiOperation({
    summary:
      'Get stories (optionally filtered by theme, category, recommended, kidId, and age)',
  })
  @ApiQuery({ name: 'theme', required: false, type: String })
  @ApiQuery({ name: 'category', required: false, type: String })
  @ApiQuery({ name: 'recommended', required: false, type: String })
  @ApiQuery({ name: 'kidId', required: false, type: String })
  @ApiQuery({ name: 'age', required: false, type: String })
  @ApiOkResponse({
    description: 'List of stories',
    type: CreateStoryDto,
    isArray: true,
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Not Found',
    type: ErrorResponseDto,
  })
  async getStories(
    @Query('theme') theme?: string,
    @Query('category') category?: string,
    @Query('recommended') recommended?: string,
    @Query('kidId') kidId?: string,
    @Query('age') age?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number = 1,
    @Query('limit', new DefaultValuePipe(12), ParseIntPipe) limit: number = 12,
  ): Promise<PaginatedStoriesDto> {
    const safePage = Math.max(1, page);
    const safeLimit = Math.max(1, Math.min(100, limit));

    return this.storyService.getStories({
      theme,
      category,
      recommended:
        recommended === 'true'
          ? true
          : recommended === 'false'
            ? false
            : undefined,
      kidId,
      age: age ? parseInt(age) : undefined,
      page: safePage,
      limit: safeLimit,
    });
  }

  @Get('categories')
  @UseInterceptors(CacheInterceptor)
  @CacheKey('categories:all')
  @CacheTTL(4 * 60 * 60 * 1000)
  @ApiOperation({ summary: 'Get all categories' })
  @ApiOkResponse({
    description: 'List of categories',
    type: CategoryDto,
    isArray: true,
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Not Found',
    type: ErrorResponseDto,
  })
  async getCategories() {
    return this.storyService.getCategories();
  }

  @Get('themes')
  @ApiOperation({ summary: 'Get all themes' })
  @ApiOkResponse({
    description: 'List of themes',
    type: ThemeDto,
    isArray: true,
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Not Found',
    type: ErrorResponseDto,
  })
  async getThemes() {
    return this.storyService.getThemes();
  }

  @Post()
  @ApiOperation({ summary: 'Create a new story' })
  @ApiBody({ type: CreateStoryDto })
  @ApiOkResponse({ description: 'Created story', type: CreateStoryDto })
  @ApiResponse({
    status: 400,
    description: 'Bad Request',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Not Found',
    type: ErrorResponseDto,
  })
  async createStory(@Body() body: CreateStoryDto) {
    return this.storyService.createStory(body);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a story' })
  @ApiParam({ name: 'id', type: String })
  @ApiBody({ type: UpdateStoryDto })
  @ApiOkResponse({ description: 'Updated story', type: UpdateStoryDto })
  @ApiResponse({
    status: 400,
    description: 'Bad Request',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Not Found',
    type: ErrorResponseDto,
  })
  async updateStory(@Param('id') id: string, @Body() body: UpdateStoryDto) {
    return this.storyService.updateStory(id, body);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a story' })
  @ApiParam({ name: 'id', type: String })
  @ApiOkResponse({ description: 'Deleted story', type: String })
  @ApiResponse({
    status: 400,
    description: 'Bad Request',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Not Found',
    type: ErrorResponseDto,
  })
  async deleteStory(@Param('id') id: string) {
    return this.storyService.deleteStory(id);
  }

  // --- Images ---
  @Post(':id/images')
  @ApiOperation({ summary: 'Add an image to a story' })
  @ApiParam({ name: 'id', type: String })
  @ApiBody({ type: StoryImageDto })
  @ApiOkResponse({ description: 'Added image', type: StoryImageDto })
  @ApiResponse({
    status: 400,
    description: 'Bad Request',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Not Found',
    type: ErrorResponseDto,
  })
  async addImage(@Param('id') id: string, @Body() body: StoryImageDto) {
    return this.storyService.addImage(id, body);
  }

  // --- Branches ---
  @Post(':id/branches')
  @ApiOperation({ summary: 'Add a branch to a story' })
  @ApiParam({ name: 'id', type: String })
  @ApiBody({ type: StoryBranchDto })
  @ApiOkResponse({ description: 'Added branch', type: StoryBranchDto })
  @ApiResponse({
    status: 400,
    description: 'Bad Request',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Not Found',
    type: ErrorResponseDto,
  })
  async addBranch(@Param('id') id: string, @Body() body: StoryBranchDto) {
    return this.storyService.addBranch(id, body);
  }

  // --- Favorites ---
  @Post('favorites')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Add a story to favorites' })
  @ApiBody({ type: FavoriteDto })
  @ApiOkResponse({ description: 'Added favorite', type: FavoriteDto })
  @ApiResponse({
    status: 400,
    description: 'Bad Request',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Not Found',
    type: ErrorResponseDto,
  })
  async addFavorite(@Body() body: FavoriteDto) {
    return this.storyService.addFavorite(body);
  }

  @Delete('favorites/:kidId/:storyId')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remove a story from favorites' })
  @ApiParam({ name: 'kidId', type: String })
  @ApiParam({ name: 'storyId', type: String })
  @ApiOkResponse({ description: 'Removed favorite', type: String })
  @ApiResponse({
    status: 400,
    description: 'Bad Request',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Not Found',
    type: ErrorResponseDto,
  })
  async removeFavorite(
    @Param('kidId') kidId: string,
    @Param('storyId') storyId: string,
  ) {
    return this.storyService.removeFavorite(kidId, storyId);
  }

  @Get('favorites/:kidId')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get kid favorites' })
  @ApiParam({ name: 'kidId', type: String })
  @ApiOkResponse({
    description: 'List of favorites',
    type: FavoriteDto,
    isArray: true,
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Not Found',
    type: ErrorResponseDto,
  })
  async getFavorites(@Param('kidId') kidId: string) {
    return this.storyService.getFavorites(kidId);
  }

  // --- Progress ---
  @Post('progress')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Set story progress' })
  @ApiBody({ type: StoryProgressDto })
  @ApiOkResponse({ description: 'Set progress', type: StoryProgressDto })
  @ApiResponse({
    status: 400,
    description: 'Bad Request',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Not Found',
    type: ErrorResponseDto,
  })
  async setProgress(@Body() body: StoryProgressDto) {
    return this.storyService.setProgress(body);
  }

  @Get('progress/:kidId/:storyId')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get story progress' })
  @ApiParam({ name: 'kidId', type: String })
  @ApiParam({ name: 'storyId', type: String })
  @ApiOkResponse({ description: 'Progress for story', type: StoryProgressDto })
  @ApiResponse({
    status: 400,
    description: 'Bad Request',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Not Found',
    type: ErrorResponseDto,
  })
  async getProgress(
    @Param('kidId') kidId: string,
    @Param('storyId') storyId: string,
  ) {
    return this.storyService.getProgress(kidId, storyId);
  }

  // --- Daily Challenge ---
  @Post('daily-challenge')
  @ApiOperation({ summary: 'Set daily challenge' })
  @ApiBody({ type: DailyChallengeDto })
  async setDailyChallenge(@Body() body: DailyChallengeDto) {
    return this.storyService.setDailyChallenge(body);
  }

  @Get('daily-challenge')
  @ApiOperation({ summary: 'Get daily challenge for a date' })
  @ApiQuery({ name: 'date', required: true, type: String })
  async getDailyChallenge(@Query('date') date: string) {
    return this.storyService.getDailyChallenge(date);
  }

  // --- Daily Challenge Assignment ---
  @Post('daily-challenge/assign')
  @ApiOperation({ summary: 'Assign a daily challenge to a kid' })
  @ApiBody({ type: AssignDailyChallengeDto })
  @ApiResponse({ status: 201, type: DailyChallengeAssignmentDto })
  async assignDailyChallenge(@Body() dto: AssignDailyChallengeDto) {
    return this.storyService.assignDailyChallenge(dto);
  }

  @Post('daily-challenge/complete')
  @ApiOperation({ summary: 'Mark a daily challenge assignment as completed' })
  @ApiBody({ type: CompleteDailyChallengeDto })
  @ApiResponse({ status: 200, type: DailyChallengeAssignmentDto })
  async completeDailyChallenge(@Body() dto: CompleteDailyChallengeDto) {
    return this.storyService.completeDailyChallenge(dto);
  }

  @Get('daily-challenge/kid/:kidId')
  @ApiOperation({ summary: 'Get all daily challenge assignments for a kid' })
  @ApiParam({ name: 'kidId', type: String })
  @ApiResponse({ status: 200, type: [DailyChallengeAssignmentDto] })
  async getAssignmentsForKid(@Param('kidId') kidId: string) {
    return this.storyService.getAssignmentsForKid(kidId);
  }

  @Get('daily-challenge/assignment/:id')
  @ApiOperation({ summary: 'Get a daily challenge assignment by id' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, type: DailyChallengeAssignmentDto })
  async getAssignmentById(@Param('id') id: string) {
    return this.storyService.getAssignmentById(id);
  }

  @Post('daily-challenge/assign-all')
  @ApiOperation({
    summary: 'Assign daily challenge to all kids (admin/manual trigger)',
  })
  @ApiOkResponse({ description: 'Daily challenges assigned to all kids.' })
  async assignDailyChallengeToAllKids() {
    await this.storyService.assignDailyChallengeToAllKids();
    return { message: 'Daily challenges assigned to all kids.' };
  }

  @Get('daily-challenge/today')
  @ApiOperation({ summary: "Get today's daily challenge assignment for a kid" })
  @ApiQuery({ name: 'kidId', required: true, type: String })
  @ApiOkResponse({
    description: "Today's daily challenge assignment",
    type: DailyChallengeAssignmentDto,
  })
  @ApiResponse({
    status: 404,
    description: 'No daily challenge assignment found',
    type: ErrorResponseDto,
  })
  async getTodaysDailyChallengeAssignment(@Query('kidId') kidId: string) {
    this.logger.log(
      `Getting today's daily challenge assignment for kid ${kidId}`,
    );
    return await this.storyService.getTodaysDailyChallengeAssignment(kidId);
  }

  @Get('daily-challenge/kid/:kidId/week')
  @ApiOperation({
    summary:
      'Get daily challenge assignments for a kid for a week (Sunday to Saturday)',
  })
  @ApiParam({ name: 'kidId', type: String })
  @ApiQuery({
    name: 'weekStart',
    required: true,
    type: String,
    description: 'Start of the week (YYYY-MM-DD, must be a Sunday)',
  })
  @ApiResponse({ status: 200, type: [DailyChallengeAssignmentDto] })
  @ApiResponse({
    status: 404,
    description: 'No daily challenge assignments found',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 500,
    description: 'Internal Server Error',
    type: ErrorResponseDto,
  })
  async getWeeklyAssignmentsForKid(
    @Param('kidId') kidId: string,
    @Query('weekStart') weekStart: string,
  ) {
    const weekStartDate = new Date(weekStart);
    weekStartDate.setHours(0, 0, 0, 0);
    return this.storyService.getWeeklyDailyChallengeAssignments(
      kidId,
      weekStartDate,
    );
  }

  // --- Voices ---
  @Post('voices/upload')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Upload a custom voice (audio file)' })
  async uploadVoice(
    @Req() req: AuthenticatedRequest,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: UploadVoiceDto,
  ): Promise<VoiceResponseDto> {
    // Upload file to Cloudinary
    const url = await this.storyService.uploadService.uploadFile(file);
    return this.storyService.uploadVoice(
      req.authUserData.userId,
      url.secure_url,
      body,
    );
  }

  @Post('voices/elevenlabs')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Register a custom ElevenLabs voice' })
  async createElevenLabsVoice(
    @Req() req: AuthenticatedRequest,
    @Body() body: CreateElevenLabsVoiceDto,
  ): Promise<VoiceResponseDto> {
    return this.storyService.createElevenLabsVoice(
      req.authUserData.userId,
      body,
    );
  }

  @Get('voices')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all voices for the user' })
  async listVoices(
    @Req() req: AuthenticatedRequest,
  ): Promise<VoiceResponseDto[]> {
    return this.storyService.listVoices(req.authUserData.userId);
  }

  @Patch('voices/preferred')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Set preferred voice for the user' })
  async setPreferredVoice(
    @Req() req: AuthenticatedRequest,
    @Body() body: SetPreferredVoiceDto,
  ): Promise<void> {
    return this.storyService.setPreferredVoice(req.authUserData.userId, body);
  }

  @Get('voices/preferred')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get preferred voice for the user' })
  async getPreferredVoice(
    @Req() req: AuthenticatedRequest,
  ): Promise<VoiceResponseDto | null> {
    return this.storyService.getPreferredVoice(req.authUserData.userId);
  }

  @Get('voices/available')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all available ElevenLabs voices' })
  async listAvailableVoices(): Promise<any[]> {
    return this.storyService.fetchAvailableVoices();
  }

  // --- Story Path / Choice Tracking ---
  @Post('story-path/start')
  @ApiOperation({ summary: 'Start a story path for a kid' })
  @ApiBody({ type: StartStoryPathDto })
  @ApiResponse({ status: 201, type: StoryPathDto })
  async startStoryPath(@Body() dto: StartStoryPathDto) {
    return this.storyService.startStoryPath(dto);
  }

  @Patch('story-path/update')
  @ApiOperation({ summary: 'Update a story path (choices)' })
  @ApiBody({ type: UpdateStoryPathDto })
  @ApiResponse({ status: 200, type: StoryPathDto })
  async updateStoryPath(@Body() dto: UpdateStoryPathDto) {
    return this.storyService.updateStoryPath(dto);
  }

  @Get('story-path/kid/:kidId')
  @ApiOperation({ summary: 'Get all story paths for a kid' })
  @ApiParam({ name: 'kidId', type: String })
  @ApiResponse({ status: 200, type: [StoryPathDto] })
  async getStoryPathsForKid(@Param('kidId') kidId: string) {
    return this.storyService.getStoryPathsForKid(kidId);
  }

  @Get('story-path/:id')
  @ApiOperation({ summary: 'Get a story path by id' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, type: StoryPathDto })
  async getStoryPathById(@Param('id') id: string) {
    return this.storyService.getStoryPathById(id);
  }

  @Get('story/audio/:id')
  @ApiOperation({ summary: 'Get audio for a story path by id' })
  @ApiParam({ name: 'id', type: String })
  @ApiQuery({ name: 'voiceType', required: false, enum: VoiceType })
  @ApiResponse({ status: 200, type: StoryPathDto })
  async getStoryPathAudioById(
    @Param('id') id: string,
    @Query('voiceType') voiceType?: VoiceType,
  ) {
    const audioUrl = await this.storyService.getStoryAudioUrl(
      id,
      voiceType ?? VoiceType.MILO,
    );

    return {
      message: 'Audio generated successfully',
      audioUrl,
      voiceType: voiceType || VoiceType.MILO,
      statusCode: 200,
    };
  }

  @Post('story/audio')
  @ApiOperation({ summary: 'Get audio for a content' })
  @ApiResponse({ status: 200, type: StoryPathDto })
  @ApiBody({ type: StoryContentAudioDto })
  async getContentAudio(@Body() dto: StoryContentAudioDto) {
    const audioUrl = await this.textToSpeechService.textToSpeechCloudUrl(
      randomUUID().toString(),
      dto.content,
      dto.voiceType,
    );

    return {
      message: 'Audio generated successfully',
      audioUrl,
      voiceType: dto.voiceType || VoiceType.MILO,
      statusCode: 200,
    };
  }

  @Post('generate')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Generate a story using AI' })
  @ApiBody({ type: GenerateStoryDto })
  @ApiOkResponse({ description: 'Generated story', type: CreateStoryDto })
  @ApiResponse({
    status: 400,
    description: 'Bad Request',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    type: ErrorResponseDto,
  })
  async generateStory(@Body() body: GenerateStoryDto) {
    // If kidId is provided, use the specialized method
    if (body.kidId) {
      return this.storyService.generateStoryForKid(
        body.kidId,
        body.themes,
        body.categories,
      );
    }

    // Otherwise, generate with provided options
    const options = {
      theme: body.themes || ['Adventure'],
      category: body.categories || ['Bedtime Stories'],
      ageMin: body.ageMin || 4,
      ageMax: body.ageMax || 8,
      language: body.language || 'English',
      kidName: body.kidName,
      additionalContext: body.additionalContext,
    };

    return this.storyService.generateStoryWithAI(options);
  }

  @Post('generate/kid/:kidId')
  @UseGuards(AuthSessionGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Generate a personalized story for a specific kid',
  })
  @ApiParam({ name: 'kidId', type: String })
  @ApiQuery({ name: 'theme', required: false, type: String })
  @ApiQuery({ name: 'category', required: false, type: String })
  @ApiOkResponse({ description: 'Generated story', type: CreateStoryDto })
  @ApiResponse({
    status: 400,
    description: 'Bad Request',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Not Found',
    type: ErrorResponseDto,
  })
  async generateStoryForKid(
    @Param('kidId') kidId: string,
    @Query('theme') theme?: string,
    @Query('category') category?: string,
  ) {
    const themes = theme ? [theme] : undefined;
    const categories = category ? [category] : undefined;
    return this.storyService.generateStoryForKid(kidId, themes, categories);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a story by id' })
  @ApiParam({ name: 'id', type: String })
  @ApiOkResponse({ description: 'Story', type: CreateStoryDto })
  @ApiResponse({
    status: 400,
    description: 'Bad Request',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized',
    type: ErrorResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Not Found',
    type: ErrorResponseDto,
  })
  async getStoryById(@Param('id') id: string) {
    return await this.storyService.getStoryById(id);
  }
}
