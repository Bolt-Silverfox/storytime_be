import 'reflect-metadata';
import { AccessControlService } from './access-control.service';
import { AccessControlModule } from './access-control.module';
import { PrismaModule } from '@/prisma/prisma.module';
import { SettingsModule } from '@/settings/settings.module';
import { NotificationModule } from '@/notification/notification.module';
import { UserModule } from '@/user/user.module';
import { AvatarModule } from '@/avatar/avatar.module';
import { RewardModule } from '@/reward/reward.module';
import { ReportsModule } from '@/reports/reports.module';
import { AnalyticsModule } from '@/analytics/analytics.module';
import { StoryModule } from '@/story/story.module';

describe('AccessControlService wiring', () => {
  it.each([
    SettingsModule,
    NotificationModule,
    UserModule,
    AvatarModule,
    RewardModule,
    ReportsModule,
    AnalyticsModule,
    StoryModule,
  ])(
    '$name imports AccessControlModule and has a controller injecting it',
    (mod) => {
      const controllers = Reflect.getMetadata('controllers', mod) as object[];
      const injects = controllers.some((c) =>
        (
          (Reflect.getMetadata('design:paramtypes', c) ?? []) as unknown[]
        ).includes(AccessControlService),
      );
      expect(injects).toBe(true);
      expect(Reflect.getMetadata('imports', mod)).toContain(
        AccessControlModule,
      );
    },
  );

  it('AccessControlModule provides, exports and can reach Prisma', () => {
    expect(Reflect.getMetadata('providers', AccessControlModule)).toContain(
      AccessControlService,
    );
    expect(Reflect.getMetadata('exports', AccessControlModule)).toContain(
      AccessControlService,
    );
    expect(Reflect.getMetadata('imports', AccessControlModule)).toContain(
      PrismaModule,
    );
  });
});
