import { v2 as cloudinary } from 'cloudinary';
import { InternalServerErrorException } from '@nestjs/common';
import { UploadService } from './upload.service';

describe('UploadService.deleteAudio', () => {
  const service = new UploadService();

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('destroys the asset with the resource type it was uploaded as', async () => {
    const destroy = jest
      .spyOn(cloudinary.uploader, 'destroy')
      .mockResolvedValue({ result: 'ok' });

    await service.deleteAudio('storytime/x', 'image');

    expect(destroy).toHaveBeenCalledWith('storytime/x', {
      resource_type: 'image',
    });
  });

  it('defaults to the video resource type used for audio', async () => {
    const destroy = jest
      .spyOn(cloudinary.uploader, 'destroy')
      .mockResolvedValue({ result: 'ok' });

    await service.deleteAudio('storytime/x');

    expect(destroy).toHaveBeenCalledWith('storytime/x', {
      resource_type: 'video',
    });
  });

  it('throws when cloudinary does not report ok', async () => {
    jest
      .spyOn(cloudinary.uploader, 'destroy')
      .mockResolvedValue({ result: 'not found' });

    await expect(service.deleteAudio('storytime/x')).rejects.toThrow(
      InternalServerErrorException,
    );
  });
});
