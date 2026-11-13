import {
  Injectable,
  InternalServerErrorException,
  Logger,
  PayloadTooLargeException,
} from '@nestjs/common';
import { JwtPayload } from '@/shared/guards/auth.guard';
import { PrismaService } from '@/prisma/prisma.service';
import { MAX_USER_UPLOAD_BYTES } from '@/shared/constants/upload.constants';
import {
  v2 as cloudinary,
  UploadApiResponse,
  UploadApiErrorResponse,
} from 'cloudinary';
import toStream from 'buffer-to-stream';

export interface UploadOwner {
  userId: string;
  exempt?: boolean;
}

export const uploadOwner = (auth: JwtPayload): UploadOwner => ({
  userId: auth.userId,
  exempt: auth.userRole === 'admin',
});

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);

  constructor(private readonly prisma: PrismaService) {}

  async uploadFile(
    file: Express.Multer.File,
    owner?: UploadOwner,
  ): Promise<UploadApiResponse> {
    return this.countedUpload(owner, file.size, () => this.putFile(file));
  }

  async uploadImage(
    file: Express.Multer.File,
    folder: string,
    owner?: UploadOwner,
  ): Promise<UploadApiResponse> {
    return this.countedUpload(owner, file.size, () =>
      this.putImage(file, folder),
    );
  }

  private async countedUpload(
    owner: UploadOwner | undefined,
    incomingBytes: number,
    upload: () => Promise<UploadApiResponse>,
  ): Promise<UploadApiResponse> {
    if (!owner || owner.exempt) return upload();
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`user_upload:${owner.userId}`}))`;
        const { _sum } = await tx.userUpload.aggregate({
          where: { userId: owner.userId },
          _sum: { bytes: true },
        });
        if ((_sum.bytes ?? 0) + incomingBytes > MAX_USER_UPLOAD_BYTES) {
          throw new PayloadTooLargeException(
            'Upload storage limit reached. Delete some uploads and try again.',
          );
        }
        const result = await upload();
        await tx.userUpload.upsert({
          where: { publicId: result.public_id },
          create: {
            userId: owner.userId,
            publicId: result.public_id,
            bytes: result.bytes,
          },
          update: { userId: owner.userId, bytes: result.bytes },
        });
        return result;
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
  }

  private putFile(file: Express.Multer.File): Promise<UploadApiResponse> {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: 'storytime',
          resource_type: 'auto',
        },
        (error: UploadApiErrorResponse, result?: UploadApiResponse) => {
          if (error) {
            this.logger.error('Cloudinary upload error:', error);
            return reject(
              new InternalServerErrorException(
                `Upload failed: ${error.message}`,
              ),
            );
          }
          if (!result) {
            return reject(
              new InternalServerErrorException(
                'Cloudinary upload returned no result',
              ),
            );
          }
          resolve(result);
        },
      );
      toStream(file.buffer).pipe(uploadStream);
    });
  }

  private putImage(
    file: Express.Multer.File,
    folder: string,
  ): Promise<UploadApiResponse> {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: `storytime/${folder}`,
          resource_type: 'image',
          transformation: [
            { width: 500, height: 500, crop: 'limit' },
            { quality: 'auto' },
            { format: 'webp' },
          ],
        },
        (error: UploadApiErrorResponse, result?: UploadApiResponse) => {
          if (error) {
            this.logger.error('Cloudinary image upload error:', error);
            return reject(
              new InternalServerErrorException(
                `Image upload failed: ${error.message}`,
              ),
            );
          }
          if (!result) {
            return reject(
              new InternalServerErrorException(
                'Cloudinary image upload returned no result',
              ),
            );
          }
          resolve(result);
        },
      );
      toStream(file.buffer).pipe(uploadStream);
    });
  }

  async uploadImageFromBuffer(
    buffer: Buffer,
    folder: string,
  ): Promise<UploadApiResponse> {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: `storytime/${folder}`,
          resource_type: 'image',
          transformation: [
            { width: 1024, height: 1024, crop: 'limit' },
            { quality: 'auto' },
            { format: 'webp' },
          ],
        },
        (error: UploadApiErrorResponse, result?: UploadApiResponse) => {
          if (error) {
            this.logger.error('Cloudinary buffer upload error:', error);
            return reject(
              new InternalServerErrorException(
                `Image buffer upload failed: ${error.message}`,
              ),
            );
          }
          if (!result) {
            return reject(
              new InternalServerErrorException(
                'Cloudinary buffer upload returned no result',
              ),
            );
          }
          resolve(result);
        },
      );
      uploadStream.end(buffer);
    });
  }

  async uploadImageFromUrl(
    imageUrl: string,
    folder: string,
  ): Promise<UploadApiResponse> {
    try {
      const result = await cloudinary.uploader.upload(imageUrl, {
        folder: `storytime/${folder}`,
        resource_type: 'image',
        transformation: [
          { width: 1024, height: 1024, crop: 'limit' },
          { quality: 'auto' },
          { format: 'webp' },
        ],
      });
      return result;
    } catch (error) {
      this.logger.error('Cloudinary URL upload error:', error);
      throw new InternalServerErrorException(
        `Image URL upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  async deleteImage(publicId: string): Promise<void> {
    try {
      const result = await cloudinary.uploader.destroy(publicId);
      if (result.result !== 'ok') {
        this.logger.error('Cloudinary delete failed:', result);
        throw new InternalServerErrorException(
          `Delete failed: ${result.result}`,
        );
      }
      await this.prisma.userUpload.deleteMany({ where: { publicId } });
    } catch (error) {
      this.logger.error('Cloudinary delete error:', error);
      if (error instanceof InternalServerErrorException) {
        throw error;
      }
      throw new InternalServerErrorException(
        `Delete failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  async uploadAudioBuffer(buffer: Buffer, filename: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: 'storytime/audio',
          resource_type: 'video',
          public_id: filename,
        },
        (error: UploadApiErrorResponse, result?: UploadApiResponse) => {
          if (error) {
            this.logger.error('Cloudinary audio upload error:', error);
            return reject(
              new InternalServerErrorException(
                `Audio upload failed: ${error.message}`,
              ),
            );
          }
          if (!result) {
            return reject(
              new InternalServerErrorException(
                'Cloudinary audio upload returned no result',
              ),
            );
          }
          resolve(result.secure_url);
        },
      );
      toStream(buffer).pipe(uploadStream);
    });
  }
}
