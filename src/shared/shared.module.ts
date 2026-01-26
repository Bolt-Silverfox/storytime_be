import { Global, Module } from '@nestjs/common';
import { AuthSessionGuard } from './guards/auth.guard';
import { AdminGuard } from './guards/admin.guard';

@Global()
@Module({
  providers: [AuthSessionGuard, AdminGuard],
  exports: [AuthSessionGuard, AdminGuard],
})
export class SharedModule {}
