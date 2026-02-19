/**
 * Seed test notifications for a user.
 *
 * Usage:
 *   npx ts-node prisma/seeds/seed-notifications.ts <userEmail>
 *
 * Example:
 *   npx ts-node prisma/seeds/seed-notifications.ts billmal071@gmail.com
 */
import { PrismaClient, NotificationCategory } from '@prisma/client';

const prisma = new PrismaClient();

const testNotifications = [
  {
    category: NotificationCategory.NEW_STORY,
    title: 'New story available!',
    body: 'A brand new adventure "The Dragon of Crystal Lake" has been added. Check it out!',
  },
  {
    category: NotificationCategory.STORY_RECOMMENDATION,
    title: 'Recommended for you',
    body: 'Based on your reading history, we think you\'ll love "The Brave Little Fox".',
  },
  {
    category: NotificationCategory.ACHIEVEMENT_UNLOCKED,
    title: 'Achievement unlocked!',
    body: 'Congratulations! You\'ve earned the "Bookworm" badge for reading 5 stories.',
  },
  {
    category: NotificationCategory.DAILY_LISTENING_REMINDER,
    title: 'Time for a story!',
    body: 'It\'s been a while since your last story. How about a quick bedtime tale?',
  },
  {
    category: NotificationCategory.WEEKLY_REPORT,
    title: 'Your weekly reading report',
    body: 'Great week! You read 3 stories and completed 2 quizzes. Keep it up!',
  },
  {
    category: NotificationCategory.STREAK_MILESTONE,
    title: '5-day reading streak!',
    body: 'Amazing! You\'ve been reading every day for 5 days straight.',
  },
];

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error('Usage: npx ts-node prisma/seeds/seed-notifications.ts <userEmail>');
    process.exit(1);
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`User with email "${email}" not found.`);
    process.exit(1);
  }

  console.log(`Creating ${testNotifications.length} test notifications for ${user.email} (${user.id})...\n`);

  const now = new Date();
  const created = await prisma.notification.createMany({
    data: testNotifications.map((n, i) => ({
      userId: user.id,
      category: n.category,
      title: n.title,
      body: n.body,
      isRead: false,
      // Stagger creation times so they appear in order (newest first)
      createdAt: new Date(now.getTime() - i * 60 * 60 * 1000), // 1 hour apart
    })),
  });

  console.log(`✓ Created ${created.count} notifications.`);
  console.log('  Pull to refresh in the app to see them.');
}

main()
  .catch((e) => {
    console.error('Failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
