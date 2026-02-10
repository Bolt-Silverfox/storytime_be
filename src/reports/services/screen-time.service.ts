import { Injectable, BadRequestException, Inject } from '@nestjs/common';
import { DailyLimitDto } from '../dto/reports.dto';
import {
  IScreenTimeRepository,
  SCREEN_TIME_REPOSITORY,
} from '../repositories';

@Injectable()
export class ScreenTimeService {
  constructor(
    @Inject(SCREEN_TIME_REPOSITORY)
    private readonly screenTimeRepository: IScreenTimeRepository,
  ) {}

  /**
   * Start a screen time session for a kid
   */
  async startScreenTimeSession(kidId: string) {
    // Check if there's an active session
    const activeSession =
      await this.screenTimeRepository.findActiveSession(kidId);

    if (activeSession) {
      return { sessionId: activeSession.id };
    }

    const session = await this.screenTimeRepository.createSession(
      kidId,
      new Date(),
    );

    return { sessionId: session.id };
  }

  /**
   * End a screen time session
   */
  async endScreenTimeSession(sessionId: string) {
    const session = await this.screenTimeRepository.findSessionById(sessionId);

    if (!session || session.endTime) {
      throw new BadRequestException('Invalid or already ended session');
    }

    const endTime = new Date();
    const duration = Math.floor(
      (endTime.getTime() - session.startTime.getTime()) / 1000,
    );

    await this.screenTimeRepository.updateSession(sessionId, {
      endTime,
      duration,
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

    const sessions = await this.screenTimeRepository.findSessionsByDateRange(
      kidId,
      today,
      tomorrow,
      true, // includeActive
    );

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
    const sessions = await this.screenTimeRepository.findSessionsByDateRange(
      kidId,
      startDate,
      endDate,
      false, // exclude active sessions
    );

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
    const kid = await this.screenTimeRepository.findKidWithParentProfile(kidId);

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
    const kid = await this.screenTimeRepository.findKidById(kidId);

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
