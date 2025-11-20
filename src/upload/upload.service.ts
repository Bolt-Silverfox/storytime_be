import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { v2 as cloudinary, UploadApiResponse, UploadApiErrorResponse } from 'cloudinary';
import * as toStream from 'buffer-to-stream';

@Injectable()
export class UploadService {
  private readonly logger = new Logger(UploadService.name);
  async uploadFile(file: Express.Multer.File): Promise<UploadApiResponse> {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        { 
          folder: 'storytime',
          resource_type: 'auto'
        },
        (error: UploadApiErrorResponse, result: UploadApiResponse) => {
          if (error) {
            this.logger.error('Cloudinary upload error:', error);
            return reject(new InternalServerErrorException(`Upload failed: ${error.message}`));
          }
          resolve(result);
        },
      );
      toStream(file.buffer).pipe(uploadStream);
    });
  }

  async uploadImage(file: Express.Multer.File, folder: string): Promise<UploadApiResponse> {
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
            return reject(new InternalServerErrorException(`Image upload failed: ${error.message}`));
          }
          resolve(result);
        },
      );
      toStream(file.buffer).pipe(uploadStream);
    });
  }

  async deleteImage(publicId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      cloudinary.uploader.destroy(publicId, (error: UploadApiErrorResponse, result: any) => {
        if (error) {
          this.logger.error('Cloudinary delete error:', error);
          return reject(new InternalServerErrorException(`Delete failed: ${error.message}`));
        }
        if (result.result !== 'ok') {
          this.logger.error('Cloudinary delete failed:', result);
          return reject(new InternalServerErrorException(`Delete failed: ${result.result}`));
        }
        resolve();
      });
    });
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
            return reject(new InternalServerErrorException(`Audio upload failed: ${error.message}`));
          }
          resolve(result.secure_url);
        },
      );
      toStream(buffer).pipe(uploadStream);
    });
  }
}