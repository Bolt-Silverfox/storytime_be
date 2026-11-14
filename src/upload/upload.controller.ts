import {
  Controller,
  Delete,
  Param,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UploadService, uploadOwner } from './upload.service';
import { ApiBody, ApiConsumes } from '@nestjs/swagger';
import {
  AuthSessionGuard,
  AuthenticatedRequest,
} from '@/shared/guards/auth.guard';

@Controller('upload')
@UseGuards(AuthSessionGuard)
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  @Post()
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Req() req: AuthenticatedRequest,
  ) {
    const result = await this.uploadService.uploadFile(
      file,
      uploadOwner(req.authUserData),
    );
    return {
      url: result.secure_url,
      publicId: result.public_id,
    };
  }

  @Delete(':publicId')
  async remove(
    @Param('publicId') publicId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.uploadService.deleteOwned(publicId, req.authUserData);
    return { success: true };
  }
}
