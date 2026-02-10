# Storytime Backend API - Project Overview

## Purpose
NestJS-based backend API for the Storytime application, providing interactive storytelling experiences for children with AI-powered story generation, user management, and content delivery.

## Tech Stack
- **Framework**: NestJS 11.x
- **Database**: PostgreSQL with Prisma ORM (v6.19)
- **Authentication**: JWT with bcryptjs, Passport
- **AI Integration**: Google Generative AI (Gemini), ElevenLabs TTS, Deepgram STT
- **File Storage**: Cloudinary
- **Queue System**: BullMQ with Redis
- **Validation**: class-validator, class-transformer, Zod
- **Process Management**: PM2
- **API Documentation**: Swagger/OpenAPI
- **Package Manager**: pnpm

## Project Structure
```
src/
├── admin/           - Admin management and analytics
├── analytics/       - User activity tracking
├── auth/            - Authentication (login, register, JWT, OAuth)
│   └── services/    - Extracted: OAuthService, OnboardingService
├── avatar/          - User avatars
├── health/          - Health check endpoints
├── kid/             - Child profile management
├── notification/    - User notifications
│   └── services/    - Extracted: NotificationPreferenceService, InAppNotificationService
├── payment/         - Payment processing
├── prisma/          - Prisma client module
├── reports/         - Usage reports and analytics
│   └── services/    - Extracted: ScreenTimeService
├── reward/          - User reward system
├── settings/        - User settings and preferences
├── story/           - Story generation and management
│   └── services/    - Extracted: StoryProgressService, DailyChallengeService
├── story-buddy/     - AI story companions
├── subscription/    - Subscription management
├── upload/          - File upload handling (Cloudinary)
├── user/            - User profile management
│   └── services/    - Extracted: UserDeletionService, UserPinService
├── utils/           - Shared utilities
├── voice/           - TTS/STT voice services
├── app.module.ts    - Root application module
└── main.ts          - Application entry point
```

## Key Features
- JWT-based authentication with OAuth (Google, Apple)
- Per-child (kidId) badge/achievement tracking
- AI-powered story generation with circuit breaker pattern
- Two-tier caching (Redis + In-Memory)
- BullMQ email queue with retry logic
- Comprehensive health checks

## Current Branch
`perf/resilience-improvements` - Performance and resilience improvements branch
