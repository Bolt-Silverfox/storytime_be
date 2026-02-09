import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';
import { DailyLimitDto } from '../dto/reports.dto';

@Injectable()
export class ScreenTimeService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Start a screen time session for a kid
   */
  async startScreenTimeSession(kidId: string) {
    // Check if there's an active session
    const activeSession = await this.prisma.screenTimeSession.findFirst({
      where: {
        kidId,
        endTime: null,
      },
    });

    if (activeSession) {
      return { sessionId: activeSession.id };
    }

    const session = await this.prisma.screenTimeSession.create({
      data: {
        kidId,
        date: new Date(),
      },
    });

    return { sessionId: session.id };
  }

  /**
   * End a screen time session
   */
  async endScreenTimeSession(sessionId: string) {
    const session = await this.prisma.screenTimeSession.findUnique({
      where: { id: sessionId },
    });

    if (!session || session.endTime) {
      throw new BadRequestException('Invalid or already ended session');
    }

    const endTime = new Date();
    const duration = Math.floor(
      (endTime.getTime() - session.startTime.getTime()) / 1000,
    );

    await this.prisma.screenTimeSession.update({
      where: { id: sessionId },
      data: {
        endTime,
        duration,
      },
    });

    return { sessionId, duration };
  }

  /**
   * Get today's screen time for a kid (in minutes)
   */
  async getTodayScreenTime(kidId: string): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const sessions = await this.prisma.screenTimeSession.findMany({
      where: {
        kidId,
        date: {
          gte: today,
          lt: tomorrow,
        },
      },
    });

    // Calculate total minutes including active session
    let totalSeconds = 0;
    const now = new Date();

    for (const session of sessions) {
      if (session.endTime && session.duration) {
        totalSeconds += session.duration;
      } else if (!session.endTime) {
        // Active session
        totalSeconds += Math.floor(
          (now.getTime() - session.startTime.getTime()) / 1000,
        );
      }
    }

    return Math.floor(totalSeconds / 60);
  }

  /**
   * Get screen time for a date range (in minutes)
   */
  async getScreenTimeForRange(
    kidId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<number> {
    const sessions = await this.prisma.screenTimeSession.findMany({
      where: {
        kidId,
        date: {
          gte: startDate,
          lt: endDate,
        },
        endTime: { not: null },
      },
    });

    const totalSeconds = sessions.reduce(
      (sum, s) => sum + (s.duration || 0),
      0,
    );
    return Math.floor(totalSeconds / 60);
  }

  /**
   * Get effective daily limit for a kid
   * Priority: Kid's specific limit > Parent's default > No limit
   */
  async getEffectiveDailyLimit(kidId: string): Promise<number | null> {
    const kid = await this.prisma.kid.findUnique({
      where: { id: kidId },
      include: {
        parent: {
          include: {
            profile: true,
          },
        },
      },
    });

    if (!kid) {
      return null;
    }

    // Priority 1: Kid's specific limit
    if (
      kid.dailyScreenTimeLimitMins !== null &&
      kid.dailyScreenTimeLimitMins !== undefined
    ) {
      return kid.dailyScreenTimeLimitMins;
    }

    // Priority 2: Parent's default limit
    if (kid.parent.profile?.maxScreenTimeMins) {
      return kid.parent.profile.maxScreenTimeMins;
    }

    // Priority 3: No limit
    return null;
  }

  /**
   * Get daily limit status
   */
  async getDailyLimitStatus(kidId: string): Promise<DailyLimitDto> {
    const kid = await this.prisma.kid.findUnique({
      where: { id: kidId },
    });

    if (!kid) {
      throw new BadRequestException('Kid not found');
    }

    const todayScreenTimeMins = await this.getTodayScreenTime(kidId);
    const limitMins = await this.getEffectiveDailyLimit(kidId);

    let remainingMins: number | undefined;
    let limitReached = false;

    if (limitMins !== null && limitMins !== undefined) {
      remainingMins = Math.max(0, limitMins - todayScreenTimeMins);
      limitReached = todayScreenTimeMins >= limitMins;
    }

    return {
      kidId,
      dailyLimitMins: limitMins ?? undefined,
      todayScreenTimeMins,
      remainingMins,
      limitReached,
    };
  }
}
