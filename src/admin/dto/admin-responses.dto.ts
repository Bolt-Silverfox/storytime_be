import { ApiProperty } from '@nestjs/swagger';

// Base response interface
export class ApiResponseDto<T> {
  @ApiProperty({ description: 'HTTP status code', example: 200 })
  statusCode: number;

  @ApiProperty({ description: 'Response message', example: 'Success' })
  message: string;

  @ApiProperty({ description: 'Response data' })
  data: T;
}

export class PaginatedApiResponseDto<T> extends ApiResponseDto<T[]> {
  @ApiProperty({ description: 'Pagination metadata' })
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export class AnalyticsMetricDto {
  @ApiProperty({ example: 2420 })
  count: number;

  @ApiProperty({ example: 12.5 })
  trendPercent: number;

  @ApiProperty({ example: 'vs last month' })
  timeframe: string;
}

// Dashboard Statistics DTO
export class DashboardStatsDto {
  @ApiProperty({ description: 'Total number of users', example: 1250 })
  totalUsers: number;

  @ApiProperty({ description: 'Total number of parent users', example: 800 })
  totalParents: number;

  @ApiProperty({ description: 'Total number of kid profiles', example: 450 })
  totalKids: number;

  @ApiProperty({ description: 'Total number of admin users', example: 5 })
  totalAdmins: number;

  @ApiProperty({ description: 'Total number of stories', example: 325 })
  totalStories: number;

  @ApiProperty({ description: 'Total number of categories', example: 20 })
  totalCategories: number;

  @ApiProperty({ description: 'Total number of themes', example: 18 })
  totalThemes: number;

  @ApiProperty({ description: 'Active users in last 24 hours', example: 120 })
  activeUsers24h: number;

  @ApiProperty({ description: 'Active users in last 7 days', example: 350 })
  activeUsers7d: number;

  @ApiProperty({ description: 'New users registered today', example: 15 })
  newUsersToday: number;

  @ApiProperty({ description: 'New users registered this week', example: 85 })
  newUsersThisWeek: number;

  @ApiProperty({ description: 'New users registered this month', example: 220 })
  newUsersThisMonth: number;

  @ApiProperty({ description: 'Total story views/progress', example: 12500 })
  totalStoryViews: number;

  @ApiProperty({ description: 'Total favorites', example: 2300 })
  totalFavorites: number;

  @ApiProperty({ description: 'Average session time in minutes', example: 15, required: false })
  averageSessionTime?: number;

  // Subscription metrics
  @ApiProperty({ description: 'Number of paid users (with active subscriptions)', example: 180 })
  paidUsers: number;

  @ApiProperty({ description: 'Number of unpaid users', example: 1070 })
  unpaidUsers: number;

  @ApiProperty({ description: 'Total number of subscriptions', example: 200 })
  totalSubscriptions: number;

  @ApiProperty({ description: 'Number of active subscriptions', example: 180 })
  activeSubscriptions: number;

  @ApiProperty({
    description: 'Subscription plan breakdown',
    example: [
      { plan: 'monthly', count: 120 },
      { plan: 'yearly', count: 60 },
      { plan: 'family', count: 20 }
    ]
  })
  subscriptionPlans: Array<{
    plan: string;
    count: number;
  }>;

  @ApiProperty({ description: 'Total revenue generated', example: 12500.50 })
  totalRevenue: number;

  @ApiProperty({ description: 'Conversion rate (paid users / total users)', example: 14.4 })
  conversionRate: number;

  @ApiProperty({ description: 'Key performance indicators with trends' })
  performanceMetrics: {
    newUsers: AnalyticsMetricDto;
    totalUsers: AnalyticsMetricDto;
    activeUsers: AnalyticsMetricDto;
    revenue: AnalyticsMetricDto;
    activeSubscriptions: AnalyticsMetricDto;
    totalStories: AnalyticsMetricDto;
    unpaidUsers: AnalyticsMetricDto;
  };
}

export class UserGrowthDto {
  @ApiProperty({ description: 'Date', example: '2023-10-01' })
  date: string;

  @ApiProperty({ description: 'New users registered on this date', example: 10 })
  newUsers: number;

  @ApiProperty({ description: 'New paid users registered on this date', example: 2 })
  paidUsers: number;

  @ApiProperty({ description: 'Cumulative total users up to this date', example: 1000 })
  totalUsers: number;

  @ApiProperty({ description: 'Cumulative total paid users up to this date', example: 150 })
  totalPaidUsers: number;
}

export class StoryStatsDto {
  @ApiProperty({ description: 'Total number of stories', example: 325 })
  totalStories: number;

  @ApiProperty({ description: 'Number of published stories', example: 325 })
  publishedStories: number;

  @ApiProperty({ description: 'Number of draft stories', example: 0 })
  draftStories: number;

  @ApiProperty({ description: 'Number of AI-generated stories', example: 150 })
  aiGeneratedStories: number;

  @ApiProperty({ description: 'Number of recommended stories', example: 75 })
  recommendedStories: number;

  @ApiProperty({ description: 'Number of deleted stories', example: 15 })
  deletedStories: number;

  @ApiProperty({ description: 'Total story views', example: 12500 })
  totalViews: number;

  @ApiProperty({ description: 'Total favorites', example: 2300 })
  totalFavorites: number;

  @ApiProperty({ description: 'Average rating', example: 4.5, required: false })
  averageRating?: number;
}

export class ContentBreakdownDto {
  @ApiProperty({
    description: 'Breakdown by language',
    example: [
      { language: 'English', count: 250 },
      { language: 'Spanish', count: 50 },
      { language: 'French', count: 25 }
    ]
  })
  byLanguage: { language: string; count: number }[];

  @ApiProperty({
    description: 'Breakdown by age group',
    example: [
      { ageRange: '3-5', count: 100 },
      { ageRange: '6-8', count: 150 },
      { ageRange: '9-12', count: 75 }
    ]
  })
  byAgeGroup: { ageRange: string; count: number }[];

  @ApiProperty({
    description: 'Breakdown by category',
    example: [
      { categoryName: 'Animal Stories', count: 80 },
      { categoryName: 'Adventure & Action', count: 70 },
      { categoryName: 'Bedtime Stories', count: 60 }
    ]
  })
  byCategory: { categoryName: string; count: number }[];

  @ApiProperty({
    description: 'Breakdown by theme',
    example: [
      { themeName: 'Adventure', count: 120 },
      { themeName: 'Friendship', count: 90 },
      { themeName: 'Courage', count: 70 }
    ]
  })
  byTheme: { themeName: string; count: number }[];
}

export class SystemHealthDto {
  @ApiProperty({
    enum: ['healthy', 'degraded', 'down'],
    example: 'healthy'
  })
  status: 'healthy' | 'degraded' | 'down';

  @ApiProperty({
    description: 'Database connection status',
    example: {
      connected: true,
      responseTime: 45
    }
  })
  database: {
    connected: boolean;
    responseTime?: number;
  };

  @ApiProperty({ description: 'System uptime in seconds', example: 86400 })
  uptime: number;

  @ApiProperty({
    description: 'Memory usage statistics',
    example: {
      used: 512,
      total: 1024,
      percentage: 50
    }
  })
  memoryUsage: {
    used: number;
    total: number;
    percentage: number;
  };

  @ApiProperty({ description: 'Timestamp of health check', example: '2023-10-15T10:30:00Z' })
  timestamp: Date;
}

export class PaginatedResponseDto<T> {
  @ApiProperty({ description: 'Array of data items' })
  data: T[];

  @ApiProperty({
    description: 'Pagination metadata',
    example: {
      total: 1250,
      page: 1,
      limit: 10,
      totalPages: 125
    }
  })
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export class SubscriptionAnalyticsDto {
  @ApiProperty({
    description: 'Subscription growth over time',
    example: [
      { date: '2023-10-01', count: 5 },
      { date: '2023-10-02', count: 3 }
    ]
  })
  subscriptionGrowth: Array<{
    date: string;
    count: number;
  }>;

  @ApiProperty({
    description: 'Revenue growth over time',
    example: [
      { date: '2023-10-01', amount: 500 },
      { date: '2023-10-02', amount: 300 }
    ]
  })
  revenueGrowth: Array<{
    date: string;
    amount: number;
  }>;

  @ApiProperty({
    description: 'Subscription plan breakdown',
    example: [
      { plan: 'monthly', count: 120 },
      { plan: 'yearly', count: 60 },
      { plan: 'family', count: 20 }
    ]
  })
  planBreakdown: Array<{
    plan: string;
    count: number;
  }>;

  @ApiProperty({ description: 'Churn rate percentage', example: 2.5 })
  churnRate: number;
}

export class RevenueAnalyticsDto {
  @ApiProperty({
    description: 'Daily revenue breakdown',
    example: [
      { date: '2023-10-01', amount: 500 },
      { date: '2023-10-02', amount: 750 }
    ]
  })
  dailyRevenue: Array<{
    date: string;
    amount: number;
  }>;

  @ApiProperty({
    description: 'Monthly revenue breakdown',
    example: [
      { month: '2023-10', total_amount: 12500 },
      { month: '2023-09', total_amount: 11800 }
    ]
  })
  monthlyRevenue: Array<{
    month: string;
    total_amount: number;
  }>;

  @ApiProperty({
    description: 'Yearly revenue breakdown',
    example: [
      { year: '2023', total_amount: 85000 },
      { year: '2022', total_amount: 72000 }
    ]
  })
  yearlyRevenue: Array<{
    year: string;
    total_amount: number;
  }>;

  @ApiProperty({
    description: 'Top subscription plans by revenue',
    example: [
      {
        plan: 'yearly',
        subscription_count: 60,
        total_revenue: 6000
      },
      {
        plan: 'monthly',
        subscription_count: 120,
        total_revenue: 4800
      }
    ]
  })
  topPlans: Array<{
    plan: string;
    subscription_count: number;
    total_revenue: number;
  }>;
}

export class UserDetailDto {
  @ApiProperty({ description: 'User ID', example: 'user-123' })
  id: string;

  @ApiProperty({ description: 'User email', example: 'parent@example.com' })
  email: string;

  @ApiProperty({ description: 'User name', example: 'John Doe' })
  name: string | null;

  @ApiProperty({ description: 'User title', example: 'Mr' })
  title: string | null;

  @ApiProperty({ description: 'User role', example: 'parent' })
  role: string;

  @ApiProperty({ description: 'Email verification status', example: true })
  isEmailVerified: boolean;

  @ApiProperty({ description: 'Deletion status', example: false })
  isDeleted: boolean;

  @ApiProperty({ description: 'Creation timestamp', example: '2023-10-01T12:00:00Z' })
  createdAt: Date;

  @ApiProperty({ description: 'Last update timestamp', example: '2023-10-15T10:30:00Z' })
  updatedAt: Date;

  @ApiProperty({ description: 'Paid user status', example: true })
  isPaidUser: boolean;

  @ApiProperty({ description: 'Total amount spent', example: 125.50 })
  totalSpent: number;

  @ApiProperty({
    description: 'User profile',
    example: {
      id: 'profile-123',
      explicitContent: false,
      maxScreenTimeMins: 120,
      language: 'english',
      country: 'US',
      createdAt: '2023-10-01T12:00:00Z',
      updatedAt: '2023-10-15T10:30:00Z'
    }
  })
  profile: any;

  @ApiProperty({
    description: 'User kids',
    example: [
      {
        id: 'kid-123',
        name: 'Emma Doe',
        ageRange: '6-8',
        createdAt: '2023-10-05T12:00:00Z',
        avatar: {
          id: 'avatar-456',
          name: 'Kid Avatar',
          url: 'https://example.com/kid-avatar.png'
        }
      }
    ]
  })
  kids: any[];

  @ApiProperty({
    description: 'User avatar',
    example: {
      id: 'avatar-123',
      name: 'Default Avatar',
      url: 'https://example.com/avatar.png',
      isSystemAvatar: true,
      publicId: 'avatar_123',
      createdAt: '2023-10-01T12:00:00Z'
    }
  })
  avatar: any;

  @ApiProperty({
    description: 'User subscriptions',
    example: [
      {
        id: 'sub-123',
        plan: 'monthly',
        status: 'active',
        startedAt: '2023-10-01T12:00:00Z',
        endsAt: '2023-11-01T12:00:00Z'
      }
    ]
  })
  subscriptions: any[];

  @ApiProperty({
    description: 'Payment transactions',
    example: [
      {
        id: 'txn-123',
        amount: 9.99,
        currency: 'USD',
        status: 'success',
        createdAt: '2023-10-01T12:00:00Z'
      }
    ]
  })
  paymentTransactions: any[];

  @ApiProperty({
    description: 'User statistics',
    example: {
      sessionsCount: 5,
      favoritesCount: 12,
      voicesCount: 1,
      subscriptionsCount: 1,
      ticketsCount: 2,
      transactionsCount: 3
    }
  })
  stats: {
    sessionsCount: number;
    favoritesCount: number;
    voicesCount: number;
    subscriptionsCount: number;
    ticketsCount: number;
    transactionsCount: number;
  };
}

export class StoryDetailDto {
  @ApiProperty({ description: 'Story ID', example: 'story-123' })
  id: string;

  @ApiProperty({ description: 'Story title', example: 'The Magic Forest' })
  title: string;

  @ApiProperty({ description: 'Story description', example: 'A magical adventure in an enchanted forest' })
  description: string;

  @ApiProperty({ description: 'Story language', example: 'english' })
  language: string;

  @ApiProperty({ description: 'Cover image URL', example: 'https://example.com/forest.jpg' })
  coverImageUrl: string;

  @ApiProperty({ description: 'Audio URL', example: 'https://example.com/forest.mp3', required: false })
  audioUrl?: string | null;

  @ApiProperty({ description: 'Text content', example: 'Once upon a time in a magical forest...', required: false })
  textContent?: string | null;

  @ApiProperty({ description: 'Is interactive story', example: true })
  isInteractive: boolean;

  @ApiProperty({ description: 'Minimum age', example: 3 })
  ageMin: number;

  @ApiProperty({ description: 'Maximum age', example: 8 })
  ageMax: number;

  @ApiProperty({ description: 'Background color', example: '#5E3A54' })
  backgroundColor: string;

  @ApiProperty({ description: 'Is recommended story', example: true })
  recommended: boolean;

  @ApiProperty({ description: 'Is AI generated', example: false })
  aiGenerated: boolean;

  @ApiProperty({ description: 'Difficulty level', example: 1 })
  difficultyLevel: number;

  @ApiProperty({ description: 'Word count', example: 500 })
  wordCount: number;

  @ApiProperty({ description: 'Deletion status', example: false })
  isDeleted: boolean;

  @ApiProperty({ description: 'Creation timestamp', example: '2023-10-01T12:00:00Z' })
  createdAt: Date;

  @ApiProperty({ description: 'Last update timestamp', example: '2023-10-15T10:30:00Z' })
  updatedAt: Date;

  @ApiProperty({
    description: 'Story images',
    example: [
      {
        id: 'img-123',
        url: 'https://example.com/forest-1.jpg',
        caption: 'The enchanted forest entrance'
      }
    ]
  })
  images: any[];

  @ApiProperty({
    description: 'Story categories',
    example: [
      { id: 'cat-1', name: 'Fantasy & Magic' }
    ]
  })
  categories: any[];

  @ApiProperty({
    description: 'Story themes',
    example: [
      { id: 'theme-1', name: 'Adventure' }
    ]
  })
  themes: any[];

  @ApiProperty({
    description: 'Story branches',
    example: [
      {
        id: 'branch-1',
        prompt: 'Which path will you take?',
        optionA: 'Take the left path',
        optionB: 'Take the right path',
        nextA: 'story-124',
        nextB: 'story-125'
      }
    ]
  })
  branches: any[];

  @ApiProperty({
    description: 'Story questions',
    example: [
      {
        id: 'question-1',
        question: 'What was the main character\'s name?',
        options: ['Alice', 'Bob', 'Charlie', 'Diana'],
        correctOption: 0
      }
    ]
  })
  questions: any[];

  @ApiProperty({
    description: 'Story statistics',
    example: {
      favoritesCount: 45,
      viewsCount: 120,
      parentFavoritesCount: 15,
      downloadsCount: 30
    }
  })
  stats: {
    favoritesCount: number;
    viewsCount: number;
    parentFavoritesCount: number;
    downloadsCount: number;
  };
}

export class CategoryDto {
  @ApiProperty({ description: 'Category ID', example: 'cat-1' })
  id: string;

  @ApiProperty({ description: 'Category name', example: 'Animal Stories' })
  name: string;

  @ApiProperty({ description: 'Category image URL', example: 'https://example.com/animals.jpg', required: false })
  image?: string | null;

  @ApiProperty({ description: 'Category description', example: 'Stories featuring animals as main characters', required: false })
  description?: string | null;

  @ApiProperty({ description: 'Deletion status', example: false })
  isDeleted: boolean;

  @ApiProperty({ description: 'Deletion timestamp', example: null, required: false })
  deletedAt?: Date | null;

  @ApiProperty({
    description: 'Category statistics',
    example: {
      stories: 80,
      preferredByKids: 45
    }
  })
  _count: {
    stories: number;
    preferredByKids: number;
  };
}

export class ThemeDto {
  @ApiProperty({ description: 'Theme ID', example: 'theme-1' })
  id: string;

  @ApiProperty({ description: 'Theme name', example: 'Adventure' })
  name: string;

  @ApiProperty({ description: 'Theme image URL', example: 'https://example.com/adventure.jpg', required: false })
  image?: string | null;

  @ApiProperty({ description: 'Theme description', example: 'Themes of adventure and exploration', required: false })
  description?: string | null;

  @ApiProperty({ description: 'Deletion status', example: false })
  isDeleted: boolean;

  @ApiProperty({ description: 'Deletion timestamp', example: null, required: false })
  deletedAt?: Date | null;

  @ApiProperty({
    description: 'Theme statistics',
    example: {
      stories: 120
    }
  })
  _count: {
    stories: number;
  };
}

export class SubscriptionDto {
  @ApiProperty({ description: 'Subscription ID', example: 'sub-123' })
  id: string;

  @ApiProperty({ description: 'Subscription plan', example: 'monthly' })
  plan: string;

  @ApiProperty({ description: 'Subscription status', example: 'active' })
  status: string;

  @ApiProperty({ description: 'Subscription start timestamp', example: '2023-10-01T12:00:00Z' })
  startedAt: Date;

  @ApiProperty({ description: 'Subscription end timestamp', example: '2023-11-01T12:00:00Z', required: false })
  endsAt?: Date | null;

  @ApiProperty({ description: 'Deletion status', example: false })
  isDeleted: boolean;

  @ApiProperty({ description: 'Deletion timestamp', example: null, required: false })
  deletedAt?: Date | null;

  @ApiProperty({
    description: 'Subscription user',
    example: {
      id: 'user-123',
      email: 'parent@example.com',
      name: 'John Doe'
    }
  })
  user: any;
}

export class ActivityLogDto {
  @ApiProperty({ description: 'Activity log ID', example: 'log-123' })
  id: string;

  @ApiProperty({ description: 'User ID', example: 'user-123', required: false })
  userId?: string | null;

  @ApiProperty({ description: 'Kid ID', example: 'kid-123', required: false })
  kidId?: string | null;

  @ApiProperty({ description: 'Action type', example: 'USER_LOGIN' })
  action: string;

  @ApiProperty({ description: 'Action status', example: 'SUCCESS' })
  status: string;

  @ApiProperty({ description: 'Device name', example: 'iPhone 13', required: false })
  deviceName?: string | null;

  @ApiProperty({ description: 'Device model', example: 'A2482', required: false })
  deviceModel?: string | null;

  @ApiProperty({ description: 'Operating system', example: 'iOS 17', required: false })
  os?: string | null;

  @ApiProperty({ description: 'IP address', example: '192.168.1.100', required: false })
  ipAddress?: string | null;

  @ApiProperty({ description: 'Action details', example: 'User logged in successfully', required: false })
  details?: string | null;

  @ApiProperty({ description: 'Creation timestamp', example: '2023-10-15T10:30:00Z' })
  createdAt: Date;

  @ApiProperty({ description: 'Deletion status', example: false })
  isDeleted: boolean;

  @ApiProperty({ description: 'Deletion timestamp', example: null, required: false })
  deletedAt?: Date | null;

  @ApiProperty({
    description: 'User information',
    example: {
      id: 'user-123',
      email: 'parent@example.com',
      name: 'John Doe'
    },
    required: false
  })
  user?: any | null;

  @ApiProperty({
    description: 'Kid information',
    example: {
      id: 'kid-123',
      name: 'Emma Doe'
    },
    required: false
  })
  kid?: any | null;
}

export class AiCreditAnalyticsDto {
  yearly: {
    month: string;
    elevenLabs: number;
    gemini: number;
    total: number;
  }[];
}

export class UserGrowthMonthlyDto {
  data: {
    labels: string[]; // ['Jan', 'Feb', ...]
    freeUsers: number[];
    paidUsers: number[];
  };
}

export class SupportTicketDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  subject: string;

  @ApiProperty()
  message: string;

  @ApiProperty()
  status: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  user: {
    id: string;
    email: string;
    name: string | null;
  };
}
