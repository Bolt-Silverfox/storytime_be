import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import toStream from 'buffer-to-stream';

@Injectable()
export class UploadService {
  async uploadFile(file: Express.Multer.File): Promise<UploadApiResponse> {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        { folder: 'storytime' },
        (error, result) => {
          if (error)
            return reject(new InternalServerErrorException(error.message));
          resolve(result as UploadApiResponse);
        },
      );
      toStream(file.buffer).pipe(uploadStream);
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
        (error, result) => {
          if (error)
            return reject(new InternalServerErrorException(error.message));
          resolve((result as UploadApiResponse).secure_url);
        },
      );
      toStream(buffer).pipe(uploadStream);
    });
  }
}
