import { Module } from '@nestjs/common';
import { UploadModule } from '@/upload/upload.module';
import { STORY_SCENE_REPOSITORY } from './scene.repository.interface';
import { PrismaStorySceneRepository } from './prisma-scene.repository';
import { SceneReadService } from './scene-read.service';
import { SceneAdminService } from './scene-admin.service';

@Module({
  imports: [UploadModule],
  providers: [
    { provide: STORY_SCENE_REPOSITORY, useClass: PrismaStorySceneRepository },
    SceneReadService,
    SceneAdminService,
  ],
  exports: [SceneReadService, SceneAdminService],
})
export class SceneModule {}
