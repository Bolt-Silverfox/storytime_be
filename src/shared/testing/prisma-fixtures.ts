/**
 * Typed fixture factories for Prisma models.
 *
 * Specs used to hand `{ id: 'user-1' } as any` to repository mocks. That makes
 * the mock accept anything, so a test keeps passing after the real signature or
 * the Prisma schema changes underneath it. These factories return *complete*
 * model rows, so a schema change breaks compilation here (one place) instead of
 * silently invalidating every spec that stubbed the model.
 *
 * Test-only: excluded from the production build in tsconfig.build.json.
 */
import type {
  Category,
  Kid,
  Profile,
  Session,
  Story,
  Theme,
  Token,
  User,
  UserIP,
} from '@prisma/client';

/** Fixed timestamp so fixtures are deterministic. */
export const FIXTURE_NOW = new Date('2026-01-01T00:00:00.000Z');

export const makeUser = (overrides: Partial<User> = {}): User => ({
  id: 'user-1',
  email: 'test@example.com',
  passwordHash: 'hashed-password',
  hasLocalPassword: true,
  name: 'Test User',
  avatarId: null,
  isEmailVerified: true,
  onboardingStatus: 'account_created',
  role: 'parent',
  createdAt: FIXTURE_NOW,
  updatedAt: FIXTURE_NOW,
  pinHash: null,
  biometricsEnabled: false,
  isSuspended: false,
  suspendedAt: null,
  isDeleted: false,
  deletedAt: null,
  hasRatedApp: false,
  rateAppDismissedAt: null,
  preferredVoiceId: null,
  googleId: null,
  appleId: null,
  premiumAccessUntil: null,
  ...overrides,
});

export const makeKid = (overrides: Partial<Kid> = {}): Kid => ({
  id: 'kid-1',
  name: 'Test Kid',
  avatarId: null,
  ageRange: '6-8',
  dailyScreenTimeLimitMins: null,
  parentId: 'user-1',
  currentReadingLevel: 1,
  createdAt: FIXTURE_NOW,
  updatedAt: FIXTURE_NOW,
  isDeleted: false,
  deletedAt: null,
  preferredVoiceId: null,
  excludedTags: [],
  isBedtimeEnabled: false,
  bedtimeStart: null,
  bedtimeEnd: null,
  bedtimeDays: [],
  bedtimeLockApp: false,
  bedtimeDimScreen: false,
  bedtimeReminder: false,
  bedtimeStoriesOnly: false,
  storyBuddyId: null,
  buddySelectedAt: null,
  ...overrides,
});

export const makeSession = (overrides: Partial<Session> = {}): Session => ({
  id: 'session-1',
  userId: 'user-1',
  token: 'refresh-token',
  expiresAt: new Date(FIXTURE_NOW.getTime() + 7 * 24 * 60 * 60 * 1000),
  createdAt: FIXTURE_NOW,
  lastActivityAt: null,
  isDeleted: false,
  deletedAt: null,
  ...overrides,
});

export const makeToken = (overrides: Partial<Token> = {}): Token => ({
  id: 'token-1',
  userId: 'user-1',
  token: 'token-value',
  type: 'password_reset',
  expiresAt: new Date(FIXTURE_NOW.getTime() + 60 * 60 * 1000),
  createdAt: FIXTURE_NOW,
  isDeleted: false,
  deletedAt: null,
  ...overrides,
});

export const makeProfile = (overrides: Partial<Profile> = {}): Profile => ({
  id: 'profile-1',
  userId: 'user-1',
  explicitContent: false,
  maxScreenTimeMins: null,
  language: 'English',
  languageCode: 'en',
  country: 'US',
  createdAt: FIXTURE_NOW,
  updatedAt: FIXTURE_NOW,
  isDeleted: false,
  deletedAt: null,
  ...overrides,
});

export const makeUserIP = (overrides: Partial<UserIP> = {}): UserIP => ({
  id: 'ip-1',
  userId: 'user-1',
  ipAddress: '203.0.113.5',
  userAgent: 'Mozilla/5.0',
  firstUsed: FIXTURE_NOW,
  lastUsed: FIXTURE_NOW,
  isDeleted: false,
  deletedAt: null,
  ...overrides,
});

export const makeStory = (overrides: Partial<Story> = {}): Story => ({
  id: 'story-1',
  title: 'Test Story',
  description: 'A test story description',
  language: 'en',
  coverImageUrl: 'https://example.com/cover.jpg',
  audioUrl: 'https://example.com/audio.mp3',
  textContent: 'Once upon a time...',
  isInteractive: false,
  ageMin: 4,
  ageMax: 8,
  backgroundColor: '#5E3A54',
  recommended: false,
  aiGenerated: false,
  isPublished: true,
  difficultyLevel: 1,
  wordCount: 0,
  durationSeconds: 300,
  createdAt: FIXTURE_NOW,
  updatedAt: FIXTURE_NOW,
  isDeleted: false,
  deletedAt: null,
  creatorKidId: null,
  ...overrides,
});

export const makeCategory = (overrides: Partial<Category> = {}): Category => ({
  id: 'cat-1',
  name: 'Adventure',
  image: 'https://example.com/adventure.jpg',
  description: 'Adventure stories',
  isDeleted: false,
  deletedAt: null,
  ...overrides,
});

export const makeTheme = (overrides: Partial<Theme> = {}): Theme => ({
  id: 'theme-1',
  name: 'Friendship',
  image: null,
  description: null,
  isDeleted: false,
  deletedAt: null,
  ...overrides,
});
