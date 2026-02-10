# Suggested Commands

## Development
```bash
pnpm start:dev          # Start development server with watch mode
pnpm start:debug        # Start with debugger attached
```

## Building
```bash
pnpm build              # Build the application
pnpm start:prod         # Start production server
```

## Testing
```bash
pnpm test               # Run unit tests
pnpm test:watch         # Run tests in watch mode
pnpm test:cov           # Generate test coverage
pnpm test:e2e           # Run end-to-end tests
pnpm test:debug         # Run tests with debugger
```

## Database
```bash
pnpm db:generate        # Generate Prisma client
pnpm db:migrate:dev     # Create new migration (development)
pnpm db:migrate:deploy  # Run migrations (production)
pnpm db:reset           # Reset database
pnpm db:seed            # Seed database with stories
pnpx prisma studio      # Launch visual database browser
```

## Code Quality
```bash
pnpm lint               # Lint and fix code (ESLint)
pnpm format             # Format code with Prettier
```

## PM2 Deployment
```bash
pnpm start:pm2:dev      # Start/restart with PM2 (development)
pnpm start:pm2:staging  # Start/restart with PM2 (staging)
pnpm start:pm2:prod     # Start/restart with PM2 (production)
pnpm deploy:dev         # Full deploy: migrate + generate + start:pm2:dev
pnpm deploy:staging     # Full deploy for staging
pnpm deploy:prod        # Full deploy for production
```

## Git Workflow
```bash
# Sync before starting work
git checkout <branch>
git pull origin <branch>

# After completing work
git add .
git commit -m "type(scope): description"
git push origin <branch>
```

## Commit Message Format
Use conventional commits:
- `feat(scope):` - New feature
- `fix(scope):` - Bug fix
- `perf(scope):` - Performance improvement
- `refactor(scope):` - Code refactoring
- `test(scope):` - Adding/updating tests
- `docs(scope):` - Documentation changes
