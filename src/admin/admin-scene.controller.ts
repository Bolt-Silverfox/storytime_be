import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  MaxFileSizeValidator,
  FileTypeValidator,
  Param,
  ParseFilePipe,
  Post,
  Put,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Admin } from './decorators/admin.decorator';
import { AdminAuditLogService } from './admin-audit-log.service';
import { SceneAdminService } from '@/story/scenes/scene-admin.service';
import {
  ApproveSceneDto,
  RejectSceneDto,
  ReplaceScenesDto,
  SceneReviewQueueQueryDto,
  UploadSceneImageDto,
} from './dto/admin-scene.dto';
import { AuthenticatedRequest } from '@/shared/guards/auth.guard';
import {
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_SIZE,
} from '@/shared/constants/upload.constants';

/**
 * Per-scene story illustration admin API. Scene state machine:
 *   PENDING_GENERATION -upload-> PENDING_REVIEW -approve-> APPROVED
 *   PENDING_REVIEW|APPROVED -reject(reason)-> REJECTED
 *   any except PENDING_GENERATION -regenerate-> PENDING_GENERATION (image cleared)
 *   upload is allowed from any state and always lands in PENDING_REVIEW.
 * Only APPROVED, non-stale scenes with an image are served to clients.
 */
@ApiBearerAuth()
@Controller('admin')
@Admin()
@ApiTags('admin')
export class AdminSceneController {
  constructor(
    private readonly scenes: SceneAdminService,
    private readonly auditLog: AdminAuditLogService,
  ) {}

  private audit(
    req: AuthenticatedRequest,
    action: string,
    targetType: string,
    targetId: string,
    details: Record<string, unknown> = {},
  ) {
    return this.auditLog.record({
      adminId: req.authUserData.userId,
      adminEmail: req.authUserData.email,
      action,
      targetType,
      targetId,
      details,
    });
  }

  @Get('stories/:storyId/scenes')
  @ApiOperation({
    summary: "List a story's scene illustrations with status",
    description:
      'Returns pageCount (backend 30-word pages) and every scene with status, reviewer and `isStale` (story text changed since the scene was defined).',
  })
  async listForStory(@Param('storyId') storyId: string) {
    const data = await this.scenes.listForStory(storyId);
    return { statusCode: 200, message: 'Scenes retrieved', data };
  }

  @Put('stories/:storyId/scenes')
  @ApiOperation({
    summary: 'Create/replace scene definitions for a story',
    description:
      'Scenes must start at page 0, be contiguous, non-overlapping and cover every page. Unchanged scenes keep their image/status; changed or new scenes reset to PENDING_GENERATION; surplus scenes are soft-deleted.',
  })
  @ApiBody({ type: ReplaceScenesDto })
  async replace(
    @Req() req: AuthenticatedRequest,
    @Param('storyId') storyId: string,
    @Body() body: ReplaceScenesDto,
  ) {
    const data = await this.scenes.replaceDefinitions(storyId, body.scenes);
    await this.audit(req, 'scene_image.define', 'Story', storyId, {
      sceneCount: body.scenes.length,
    });
    return { statusCode: 200, message: 'Scenes saved', data };
  }

  @Post('scene-images/:id/image')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_IMAGE_SIZE } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload an illustration for a scene',
    description:
      'Uploads to Cloudinary (max 1024x1024, webp) and moves the scene to PENDING_REVIEW, clearing any previous review.',
  })
  async uploadImage(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: MAX_IMAGE_SIZE }),
          new FileTypeValidator({ fileType: ALLOWED_IMAGE_TYPES }),
        ],
      }),
    )
    file: Express.Multer.File,
    @Body() body: UploadSceneImageDto,
  ) {
    const { scene: data, previousImageUrl } = await this.scenes.uploadImage(
      id,
      file,
      body,
    );
    await this.audit(req, 'scene_image.upload', 'StorySceneImage', id, {
      provider: body.provider,
      model: body.model,
      previousImageUrl,
      imageUrl: data.imageUrl,
    });
    return { statusCode: 201, message: 'Scene image uploaded', data };
  }

  @Post('scene-images/:id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Approve a scene image',
    description:
      'Body must carry the imageUrl the reviewer saw; 409 if the image changed or the scene was concurrently rejected/regenerated. Requires status PENDING_REVIEW, an imageUrl and a non-stale scene. Records the reviewer.',
  })
  @ApiBody({ type: ApproveSceneDto })
  async approve(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: ApproveSceneDto,
  ) {
    const data = await this.scenes.approve(
      id,
      req.authUserData.userId,
      body.imageUrl,
    );
    await this.audit(req, 'scene_image.approve', 'StorySceneImage', id, {
      imageUrl: body.imageUrl,
    });
    return { statusCode: 200, message: 'Scene image approved', data };
  }

  @Post('scene-images/:id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject a scene image (reason required)' })
  @ApiBody({ type: RejectSceneDto })
  async reject(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() body: RejectSceneDto,
  ) {
    const data = await this.scenes.reject(
      id,
      req.authUserData.userId,
      body.reason,
      body.imageUrl,
    );
    await this.audit(req, 'scene_image.reject', 'StorySceneImage', id, {
      reason: body.reason,
      imageUrl: body.imageUrl,
    });
    return { statusCode: 200, message: 'Scene image rejected', data };
  }

  @Post('scene-images/:id/regenerate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Request regeneration',
    description:
      'Sets the scene back to PENDING_GENERATION and clears its image and review fields.',
  })
  async regenerate(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    const { scene: data, previousImageUrl } =
      await this.scenes.requestRegenerate(id);
    await this.audit(req, 'scene_image.regenerate', 'StorySceneImage', id, {
      previousImageUrl,
    });
    return { statusCode: 200, message: 'Regeneration requested', data };
  }

  @Get('scene-images')
  @ApiOperation({
    summary: 'Scene review queue across stories',
    description:
      'Filter by status (default PENDING_REVIEW), paginated (page, limit<=100), oldest update first.',
  })
  async reviewQueue(@Query() query: SceneReviewQueueQueryDto) {
    const { data, meta } = await this.scenes.reviewQueue({
      status: query.status,
      page: query.page,
      limit: query.limit,
    });
    return { statusCode: 200, message: 'Review queue retrieved', data, meta };
  }
}
