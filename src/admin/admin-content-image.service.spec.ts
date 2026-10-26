import { Test, TestingModule } from '@nestjs/testing';
import {
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import { AdminContentImageService } from './admin-content-image.service';
import { UploadService } from '../upload/upload.service';
import {
  CircuitBreakerService,
  CircuitState,
} from '@/shared/services/circuit-breaker.service';
import { ADMIN_STORY_REPOSITORY } from './repositories';

describe('AdminContentImageService', () => {
  let service: AdminContentImageService;
  let cbService: CircuitBreakerService;
  let httpPost: jest.Mock;
  const findCategoryById = jest.fn();
  const findThemeById = jest.fn();
  const updateCategoryImage = jest.fn();
  const updateThemeImage = jest.fn();
  const uploadImageFromBuffer = jest.fn();
  const uploadImage = jest.fn();

  beforeEach(async () => {
    jest.clearAllMocks();
    httpPost = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminContentImageService,
        CircuitBreakerService,
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue('test-hf-token') },
        },
        { provide: HttpService, useValue: { post: httpPost } },
        {
          provide: UploadService,
          useValue: { uploadImageFromBuffer, uploadImage },
        },
        {
          provide: ADMIN_STORY_REPOSITORY,
          useValue: {
            findCategoryById,
            findThemeById,
            updateCategoryImage,
            updateThemeImage,
          },
        },
      ],
    }).compile();

    service = module.get(AdminContentImageService);
    cbService = module.get(CircuitBreakerService);
  });

  describe('generateCategoryImage', () => {
    it('throws NotFoundException when the category does not exist', async () => {
      findCategoryById.mockResolvedValue(null);

      await expect(service.generateCategoryImage('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('generates a prompt, calls HF, uploads to the categories folder, and persists the url', async () => {
      findCategoryById.mockResolvedValue({
        id: 'cat-1',
        name: 'Animal Stories',
        description: 'Stories about animals',
      });
      httpPost.mockReturnValue(of({ data: Buffer.alloc(2048, 1) }));
      uploadImageFromBuffer.mockResolvedValue({
        secure_url: 'https://cdn/categories/cat-1.webp',
      });
      updateCategoryImage.mockResolvedValue({
        id: 'cat-1',
        image: 'https://cdn/categories/cat-1.webp',
      });

      const result = await service.generateCategoryImage('cat-1');

      expect(httpPost).toHaveBeenCalledWith(
        expect.stringContaining('huggingface'),
        expect.objectContaining({
          inputs: expect.stringContaining('Animal Stories'),
        }),
        expect.anything(),
      );
      expect(uploadImageFromBuffer).toHaveBeenCalledWith(
        expect.any(Buffer),
        'categories',
      );
      expect(updateCategoryImage).toHaveBeenCalledWith(
        'cat-1',
        'https://cdn/categories/cat-1.webp',
      );
      expect(result.image).toBe('https://cdn/categories/cat-1.webp');
    });

    it('maps a non-retryable 4xx from the HF provider (e.g. 410 Gone for a deprecated model) to ServiceUnavailableException, not the generic 500', async () => {
      findCategoryById.mockResolvedValue({
        id: 'cat-1',
        name: 'Animal Stories',
        description: null,
      });
      const axiosError = Object.assign(
        new Error('Request failed with status code 410'),
        {
          isAxiosError: true,
          response: {
            status: 410,
            data: {
              error:
                'The requested model is deprecated and no longer supported by provider hf-inference',
            },
          },
        },
      );
      httpPost.mockReturnValue(throwError(() => axiosError));

      await expect(service.generateCategoryImage('cat-1')).rejects.toThrow(
        ServiceUnavailableException,
      );
      // Not retried (isTransientError excludes non-429 4xx) and not the
      // misleading "Please try again" generic message.
      expect(httpPost).toHaveBeenCalledTimes(1);
    });

    it('does not treat a 408 as a permanent provider failure', async () => {
      findCategoryById.mockResolvedValue({
        id: 'cat-1',
        name: 'Animal Stories',
        description: null,
      });
      const axiosError = Object.assign(
        new Error('Request failed with status code 408'),
        {
          isAxiosError: true,
          response: { status: 408, data: { error: 'Request timeout' } },
        },
      );
      httpPost.mockReturnValue(throwError(() => axiosError));

      // 408 is a timeout, not a permanent failure like 410/402 — it must
      // fall through to the generic "please try again" message rather than
      // the "retrying will not help" ServiceUnavailableException.
      await expect(service.generateCategoryImage('cat-1')).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('maps a CircuitOpenError to ServiceUnavailableException once the hf-image breaker trips', async () => {
      findCategoryById.mockResolvedValue({
        id: 'cat-1',
        name: 'Animal Stories',
        description: null,
      });
      httpPost.mockReturnValue(throwError(() => ({ status: 503 })));

      for (let i = 0; i < 5; i++) {
        await expect(service.generateCategoryImage('cat-1')).rejects.toThrow(
          InternalServerErrorException,
        );
      }
      expect(cbService.getBreaker('hf-image').getSnapshot().state).toBe(
        CircuitState.OPEN,
      );

      await expect(service.generateCategoryImage('cat-1')).rejects.toThrow(
        ServiceUnavailableException,
      );
    }, 20000);
  });

  describe('generateThemeImage', () => {
    it('throws NotFoundException when the theme does not exist', async () => {
      findThemeById.mockResolvedValue(null);

      await expect(service.generateThemeImage('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('uploads to the themes folder and persists the url', async () => {
      findThemeById.mockResolvedValue({
        id: 'theme-1',
        name: 'Adventure',
        description: 'Exploration and adventure',
      });
      httpPost.mockReturnValue(of({ data: Buffer.alloc(2048, 1) }));
      uploadImageFromBuffer.mockResolvedValue({
        secure_url: 'https://cdn/themes/theme-1.webp',
      });
      updateThemeImage.mockResolvedValue({
        id: 'theme-1',
        image: 'https://cdn/themes/theme-1.webp',
      });

      const result = await service.generateThemeImage('theme-1');

      expect(uploadImageFromBuffer).toHaveBeenCalledWith(
        expect.any(Buffer),
        'themes',
      );
      expect(result.image).toBe('https://cdn/themes/theme-1.webp');
    });
  });

  describe('uploadCategoryImage (direct, no AI)', () => {
    it('throws NotFoundException when the category does not exist', async () => {
      findCategoryById.mockResolvedValue(null);

      await expect(
        service.uploadCategoryImage('missing', {} as Express.Multer.File),
      ).rejects.toThrow(NotFoundException);
      expect(uploadImage).not.toHaveBeenCalled();
    });

    it('uploads the given file directly and persists the url, without calling HF', async () => {
      findCategoryById.mockResolvedValue({ id: 'cat-1', name: 'Animals' });
      uploadImage.mockResolvedValue({
        secure_url: 'https://cdn/categories/manual.webp',
      });
      updateCategoryImage.mockResolvedValue({
        id: 'cat-1',
        image: 'https://cdn/categories/manual.webp',
      });

      const file = { buffer: Buffer.from('x') } as Express.Multer.File;
      const result = await service.uploadCategoryImage('cat-1', file);

      expect(uploadImage).toHaveBeenCalledWith(file, 'categories');
      expect(httpPost).not.toHaveBeenCalled();
      expect(result.image).toBe('https://cdn/categories/manual.webp');
    });
  });

  describe('uploadThemeImage (direct, no AI)', () => {
    it('throws NotFoundException when the theme does not exist', async () => {
      findThemeById.mockResolvedValue(null);

      await expect(
        service.uploadThemeImage('missing', {} as Express.Multer.File),
      ).rejects.toThrow(NotFoundException);
      expect(uploadImage).not.toHaveBeenCalled();
    });

    it('uploads the given file directly and persists the url', async () => {
      findThemeById.mockResolvedValue({ id: 'theme-1', name: 'Adventure' });
      uploadImage.mockResolvedValue({
        secure_url: 'https://cdn/themes/manual.webp',
      });
      updateThemeImage.mockResolvedValue({
        id: 'theme-1',
        image: 'https://cdn/themes/manual.webp',
      });

      const file = { buffer: Buffer.from('x') } as Express.Multer.File;
      const result = await service.uploadThemeImage('theme-1', file);

      expect(uploadImage).toHaveBeenCalledWith(file, 'themes');
      expect(result.image).toBe('https://cdn/themes/manual.webp');
    });
  });
});
