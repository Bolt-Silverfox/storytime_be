import { NestFactory } from '@nestjs/core';
import { AvatarModule } from './avatar.module';
import { AvatarSeederService } from './avatar.seeder.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AvatarModule);

  const seeder = app.get(AvatarSeederService);
  await seeder.seedAvatars();

  await app.close();
}
bootstrap();
