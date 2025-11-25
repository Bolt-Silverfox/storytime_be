import { Module } from '@nestjs/common';
import { CategoryService } from './category.service';
import { CategoryController } from './category.controller';
import { CategorySeederService } from './category.seeder';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [CategoryController],
  providers: [CategoryService, CategorySeederService],
  exports: [CategoryService],
})
export class CategoryModule {}
