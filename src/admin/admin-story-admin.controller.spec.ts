import { Test, TestingModule } from '@nestjs/testing';
import { GUARDS_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { AdminStoryAdminController } from './admin-story-admin.controller';
import { AdminService } from './admin.service';
import { AdminStoryService } from './admin-story.service';
import { AdminContentImageService } from './admin-content-image.service';
import { AuthSessionGuard } from '@/shared/guards/auth.guard';
import { AdminGuard } from '@/shared/guards/admin.guard';

describe('AdminStoryAdminController (category/theme cover images)', () => {
  let controller: AdminStoryAdminController;
  const generateCategoryImage = jest.fn();
  const generateThemeImage = jest.fn();
  const uploadCategoryImage = jest.fn();
  const uploadThemeImage = jest.fn();

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminStoryAdminController],
      providers: [
        { provide: AdminService, useValue: {} },
        { provide: AdminStoryService, useValue: {} },
        {
          provide: AdminContentImageService,
          useValue: {
            generateCategoryImage,
            generateThemeImage,
            uploadCategoryImage,
            uploadThemeImage,
          },
        },
      ],
    })
      .overrideGuard(AuthSessionGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(AdminGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = module.get(AdminStoryAdminController);
  });

  it('wires AuthSessionGuard and AdminGuard on the controller (@Admin())', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, AdminStoryAdminController),
    ).toEqual([AuthSessionGuard, AdminGuard]);
  });

  describe('image endpoint HTTP status codes', () => {
    it.each([
      'generateCategoryImage',
      'uploadCategoryImage',
      'generateThemeImage',
      'uploadThemeImage',
    ])(
      '%s declares @HttpCode(200), matching its documented/returned statusCode',
      (methodName) => {
        expect(
          Reflect.getMetadata(
            HTTP_CODE_METADATA,
            (controller as unknown as Record<string, () => void>)[methodName],
          ),
        ).toBe(200);
      },
    );
  });

  describe('categories', () => {
    it('generateCategoryImage delegates to the service and returns the updated category', async () => {
      generateCategoryImage.mockResolvedValue({
        id: 'cat-1',
        image: 'https://cdn/categories/cat-1.webp',
      });

      const result = await controller.generateCategoryImage('cat-1');

      expect(generateCategoryImage).toHaveBeenCalledWith('cat-1');
      expect(result.statusCode).toBe(200);
      expect(result.data.image).toBe('https://cdn/categories/cat-1.webp');
    });

    it('uploadCategoryImage passes the uploaded file through to the service', async () => {
      const file = { buffer: Buffer.from('x') } as Express.Multer.File;
      uploadCategoryImage.mockResolvedValue({
        id: 'cat-1',
        image: 'https://cdn/categories/manual.webp',
      });

      const result = await controller.uploadCategoryImage('cat-1', file);

      expect(uploadCategoryImage).toHaveBeenCalledWith('cat-1', file);
      expect(result.statusCode).toBe(200);
      expect(result.data.image).toBe('https://cdn/categories/manual.webp');
    });
  });

  describe('themes', () => {
    it('generateThemeImage delegates to the service', async () => {
      generateThemeImage.mockResolvedValue({
        id: 'theme-1',
        image: 'https://cdn/themes/theme-1.webp',
      });

      const result = await controller.generateThemeImage('theme-1');

      expect(generateThemeImage).toHaveBeenCalledWith('theme-1');
      expect(result.data.image).toBe('https://cdn/themes/theme-1.webp');
    });

    it('uploadThemeImage passes the uploaded file through to the service', async () => {
      const file = { buffer: Buffer.from('x') } as Express.Multer.File;
      uploadThemeImage.mockResolvedValue({
        id: 'theme-1',
        image: 'https://cdn/themes/manual.webp',
      });

      const result = await controller.uploadThemeImage('theme-1', file);

      expect(uploadThemeImage).toHaveBeenCalledWith('theme-1', file);
      expect(result.data.image).toBe('https://cdn/themes/manual.webp');
    });
  });
});
