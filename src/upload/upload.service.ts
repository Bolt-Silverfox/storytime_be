import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import {
  v2 as cloudinary,
  UploadApiResponse,
  UploadApiErrorResponse,
} from 'cloudinary';
import toStream from 'buffer-to-stream';

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);
  async uploadFile(file: Express.Multer.File): Promise<UploadApiResponse> {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: 'storytime',
          resource_type: 'auto',
        },
        (error: UploadApiErrorResponse, result: UploadApiResponse) => {
          if (error) {
            this.logger.error('Cloudinary upload error:', error);
            return reject(
              new InternalServerErrorException(
                `Upload failed: ${error.message}`,
              ),
            );
          }
          resolve(result);
        },
      );
      toStream(file.buffer).pipe(uploadStream);
    });
  }

  async uploadImage(
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
        (error: UploadApiErrorResponse, result: UploadApiResponse) => {
          if (error) {
            this.logger.error('Cloudinary image upload error:', error);
            return reject(
              new InternalServerErrorException(
                `Image upload failed: ${error.message}`,
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
        (error: UploadApiErrorResponse, result: UploadApiResponse) => {
          if (error) {
            this.logger.error('Cloudinary buffer upload error:', error);
            return reject(
              new InternalServerErrorException(
                `Image buffer upload failed: ${error.message}`,
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
        (error: UploadApiErrorResponse, result: UploadApiResponse) => {
          if (error) {
            this.logger.error('Cloudinary audio upload error:', error);
            return reject(
              new InternalServerErrorException(
                `Audio upload failed: ${error.message}`,
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
