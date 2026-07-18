import { Module } from '@nestjs/common';
import { CouponController } from './coupon.controller';
import { CouponService } from './coupon.service';
import { PrismaModule } from '@/prisma/prisma.module';
import { AuthModule } from '@/auth/auth.module';
import {
  COUPON_REPOSITORY,
  PrismaCouponRepository,
  COUPON_REDEMPTION_REPOSITORY,
  PrismaCouponRedemptionRepository,
  USER_REPOSITORY,
  PrismaUserRepository,
} from './repositories';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [CouponController],
  providers: [
    CouponService,
    // Repository Pattern (testability, decoupling)
    {
      provide: COUPON_REPOSITORY,
      useClass: PrismaCouponRepository,
    },
    {
      provide: COUPON_REDEMPTION_REPOSITORY,
      useClass: PrismaCouponRedemptionRepository,
    },
    {
      provide: USER_REPOSITORY,
      useClass: PrismaUserRepository,
    },
  ],
  exports: [CouponService],
})
export class CouponModule {}
