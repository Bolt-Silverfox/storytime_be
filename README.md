# Storytime Backend API

A NestJS-based backend API for the Storytime application, providing interactive storytelling experiences for children with AI-powered story generation, user management, and content delivery.

## Features

- **Authentication & Authorization**: JWT-based authentication with user registration and login
- **User Management**: User profiles, settings, and preferences
- **Story Module**: AI-powered story generation using Google Generative AI
  - Theme and adventure-based stories
  - Story seeding and management
- **Settings**: User preferences including content filters, screen time, and language
- **Analytics**: User activity tracking and insights
- **Rewards**: User reward system
- **Notifications**: User notification management
- **File Upload**: Cloudinary integration for media uploads
- **Health Checks**: API health monitoring endpoint
- **API Documentation**: Interactive Swagger UI at `/docs`

## Tech Stack

- **Framework**: NestJS 11.x
- **Database**: PostgreSQL with Prisma ORM
- **Authentication**: JWT with bcryptjs
- **AI Integration**: Google Generative AI
- **File Storage**: Cloudinary
- **Validation**: class-validator, class-transformer, Zod
- **Process Management**: PM2
- **API Documentation**: Swagger/OpenAPI

## Getting Started

### Prerequisites

- Node.js (v18+)
- pnpm
- PostgreSQL database
- Cloudinary account (for file uploads)
- Google Generative AI API key (for story generation)

### Installation

1. Install dependencies:
```bash
pnpm install
```
2. Set up environment variables:
Create a `.env` file in the project root with the following:
```env
DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DATABASE?schema=public"
JWT_SECRET="your-jwt-secret"
GOOGLE_AI_API_KEY="your-google-ai-key"
CLOUDINARY_CLOUD_NAME="your-cloudinary-cloud-name"
CLOUDINARY_API_KEY="your-cloudinary-api-key"
CLOUDINARY_API_SECRET="your-cloudinary-api-secret"
```

3. Run database migrations:
```bash
pnpm migrate
```

4. Generate Prisma client:
```bash
pnpm generate
```
5. (Optional) Seed the database with initial stories:
```bash
pnpm db:seed
```

### Development

Start the development server with hot-reload:
```bash
pnpm start:dev
```

The API will be available at `http://localhost:3000`

Access Swagger documentation at `http://localhost:3000/docs`

### Production

Build and start the application:
```bash
pnpm build
pnpm start:prod
```

Or use PM2 for process management:
```bash
pnpm start:pm2
```

### Deployment

Deploy to development environment (runs migrations, generates Prisma client, and starts with PM2):
```bash
pnpm deploy:dev
```

## Project Structure

```
src/
├── analytics/      - User activity tracking and analytics
├── auth/          - Authentication (login, register, JWT)
├── config/        - Application configuration
├── health/        - Health check endpoints
├── notification/  - User notifications
├── prisma/        - Prisma client module
├── reward/        - User reward system
├── settings/      - User settings and preferences
├── story/         - Story generation and management
├── upload/        - File upload handling (Cloudinary)
├── user/          - User profile management
├── utils/         - Shared utilities
├── app.module.ts  - Root application module
└── main.ts        - Application entry point
```

## Available Scripts

### Development
- `pnpm start:dev` - Start development server with watch mode
- `pnpm start:debug` - Start with debugger

### Database
- `pnpm generate` - Generate Prisma client
- `pnpm migrate` - Run migrations (production)
- `pnpm make-migration` - Create new migration (development)
- `pnpm db:reset` - Reset database
- `pnpm db:seed` - Seed database with stories

### Production
- `pnpm build` - Build the application
- `pnpm start:prod` - Start production server
- `pnpm start:pm2` - Start/restart with PM2
- `pnpm deploy:dev` - Deploy to dev environment

### Code Quality
- `pnpm lint` - Lint and fix code
- `pnpm format` - Format code with Prettier

### Testing
- `pnpm test` - Run unit tests
- `pnpm test:watch` - Run tests in watch mode
- `pnpm test:cov` - Generate test coverage
- `pnpm test:e2e` - Run end-to-end tests
- `pnpm test:debug` - Run tests with debugger

## Database Management

### Prisma Studio
Launch the visual database browser:
```bash
pnpx prisma studio
```

## Achievement / Badge Per-Child (kidId) Changes

This project was updated to support per-child (per `Kid`) badge progress. Key notes:

- The Prisma model `UserBadge` now includes an optional `kidId` field and the unique constraint is on `(userId, kidId, badgeId)`. This allows storing badges per child as well as parent-level badges.
- Service updates: `BadgeService.updateBadgeProgress(userId, badgeType, increment, metadata, kidId?)` accepts an optional `kidId` to scope progress.
- The `BadgeProgressEngine` now propagates `kidId` from activity events into badge updates when available.

Important migration steps (run locally):

1. Create a migration to update the database schema:
```powershell
pnpm prisma migrate dev --name add-userbadge-kidid
```

2. Generate the Prisma client:
```powershell
pnpm prisma generate
```

3. Initialize badges for existing users (optional): the `BadgeService.initializeUserBadges(userId)` will create both parent-level and per-kid badge records for each user. You can call this from a seed script or an admin endpoint.

Testing the kid-scoped endpoints and badge flow (Postman):

1. Start the server:
```powershell
pnpm start:dev
```

2. Create or use an authenticated parent user and create a `Kid` record (via API or directly in the DB).

3. Trigger a kid-scoped activity (for example, complete a daily challenge): POST to `/achievement/complete-daily-challenge` (or call the equivalent endpoint) with the `kidId` in the body. The engine will record activity and update the per-kid `UserBadge` record.

4. Retrieve badges for the kid:
- GET `/badges/preview?kidId=<kidId>` — returns top 3 badges scoped to that kid.
- GET `/badges/full?kidId=<kidId>` — returns the full badge list for the kid.

If you prefer, you can also query the `user_badges` table directly in Prisma Studio to inspect per-kid rows.

If you want, I can add explicit controller endpoints for kid-scoped badge queries and a small Postman collection with example requests.
## License

UNLICENSED - Private project
