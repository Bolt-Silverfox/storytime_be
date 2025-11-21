import { Module } from '@nestjs/common';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { SoftDeleteService } from '../common/soft-delete.service';
import PrismaService from '../prisma/prisma.service'; // Add this import
@Module({
  controllers: [UserController],
  providers: [UserService, SoftDeleteService, PrismaService]
})
export class UserModule {}