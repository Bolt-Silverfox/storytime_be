// ==================== Types ====================
export interface DurationSumResult {
  _sum: { duration: number | null };
}

// ==================== Repository Interface ====================
export interface IScreenTimeSessionRepository {
  // Sum the duration of ended screen time sessions for the given kids
  sumDurationForKids(kidIds: string[]): Promise<DurationSumResult>;
}

export const SCREEN_TIME_SESSION_REPOSITORY = Symbol(
  'SCREEN_TIME_SESSION_REPOSITORY',
);
