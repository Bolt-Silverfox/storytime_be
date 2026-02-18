import { Injectable } from '@nestjs/common';

export interface BadgeMetadata {
  eventType?: string;
  timeConstraint?: string;
  correctOnly?: boolean;
  [key: string]: string | boolean | number | undefined;
}

export interface BadgeDefinition {
  title: string;
  description: string;
  iconUrl?: string;
  unlockCondition: string;
  badgeType: 'count' | 'streak' | 'time' | 'special';
  requiredAmount: number;
  priority: number;
  metadata?: BadgeMetadata;
}

@Injectable()
export class BadgeConstants {
  // Initial badge catalog
  readonly CATALOG: BadgeDefinition[] = [
    {
      title: 'First Story',
      description: 'Read your first story',
      iconUrl: 'https://cdn.storytime.com/badges/first-story.png',
      unlockCondition: 'Read 1 story',
      badgeType: 'count',
      requiredAmount: 1,
      priority: 10,
      metadata: { eventType: 'story_read' },
    },
    {
      title: 'Story Explorer',
      description: 'Read 10 stories',
      iconUrl: 'https://cdn.storytime.com/badges/story-explorer.png',
      unlockCondition: 'Read 10 stories',
      badgeType: 'count',
      requiredAmount: 10,
      priority: 20,
      metadata: { eventType: 'story_read' },
    },
    {
      title: 'Story Master',
      description: 'Read 50 stories',
      iconUrl: 'https://cdn.storytime.com/badges/story-master.png',
      unlockCondition: 'Read 50 stories',
      badgeType: 'count',
      requiredAmount: 50,
      priority: 30,
      metadata: { eventType: 'story_read' },
    },
    {
      title: 'Challenge Champion',
      description: 'Complete 5 daily challenges',
      iconUrl: 'https://cdn.storytime.com/badges/challenge-champion.png',
      unlockCondition: 'Complete 5 daily challenges',
      badgeType: 'count',
      requiredAmount: 5,
      priority: 25,
      metadata: { eventType: 'challenge_completed' },
    },
    {
      title: 'Week Warrior',
      description: 'Active for 7 consecutive days',
      iconUrl: 'https://cdn.storytime.com/badges/week-warrior.png',
      unlockCondition: '7-day streak',
      badgeType: 'streak',
      requiredAmount: 7,
      priority: 35,
      metadata: { eventType: 'activity_log' },
    },
    {
      title: 'Early Bird',
      description: 'Read a story before 7 AM',
      iconUrl: 'https://cdn.storytime.com/badges/early-bird.png',
      unlockCondition: 'Read before 7 AM',
      badgeType: 'special',
      requiredAmount: 1,
      priority: 15,
      metadata: { eventType: 'story_read', timeConstraint: 'before_7am' },
    },
    {
      title: 'Night Owl',
      description: 'Read a story after 9 PM',
      iconUrl: 'https://cdn.storytime.com/badges/night-owl.png',
      unlockCondition: 'Read after 9 PM',
      badgeType: 'special',
      requiredAmount: 1,
      priority: 15,
      metadata: { eventType: 'story_read', timeConstraint: 'after_9pm' },
    },
    {
      title: 'Quiz Whiz',
      description: 'Answer 20 quiz questions correctly',
      iconUrl: 'https://cdn.storytime.com/badges/quiz-whiz.png',
      unlockCondition: '20 correct answers',
      badgeType: 'count',
      requiredAmount: 20,
      priority: 20,
      metadata: { eventType: 'quiz_answered', correctOnly: true },
    },
  ];

  // Badge catalog for easy lookup
  readonly BADGE_DEFS_BY_TYPE: Record<string, BadgeDefinition[]> =
    this.groupByEventType();

  private groupByEventType(): Record<string, BadgeDefinition[]> {
    const grouped: Record<string, BadgeDefinition[]> = {};
    for (const badge of this.CATALOG) {
      const eventType = badge.metadata?.eventType || 'general';
      if (!grouped[eventType]) grouped[eventType] = [];
      grouped[eventType].push(badge);
    }
    return grouped;
  }
}
