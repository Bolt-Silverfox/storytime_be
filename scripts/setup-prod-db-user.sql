-- =============================================================================
-- Storytime Production Database User Setup
-- =============================================================================
-- Creates TWO database users with separate concerns:
--
--   storytime_migrator  — runs Prisma migrations & seeding (full DDL + DML)
--   storytime_app       — runtime application user (DML only)
--
-- Run this script as the PostgreSQL superuser (e.g., postgres) on the
-- target database.
--
-- Usage:
--   psql -h <host> -U postgres -d storytime_prod -f scripts/setup-prod-db-user.sql
--
-- After running, set these in your production .env / GitHub secrets:
--   DATABASE_URL=postgresql://storytime_app:<APP_PASSWORD>@<host>:5432/storytime_prod?schema=public
--   MIGRATE_DATABASE_URL=postgresql://storytime_migrator:<MIGRATOR_PASSWORD>@<host>:5432/storytime_prod?schema=public
--
-- Deployment workflow:
--   1. Run migrations with MIGRATE_DATABASE_URL:
--      DATABASE_URL=$MIGRATE_DATABASE_URL npx prisma migrate deploy
--   2. Seed with MIGRATE_DATABASE_URL:
--      DATABASE_URL=$MIGRATE_DATABASE_URL pnpm db:seed
--   3. Start the app with DATABASE_URL (storytime_app)
-- =============================================================================

BEGIN;

-- =============================================================================
-- CLEANUP: Remove existing roles if re-running this script
-- =============================================================================
-- Uses a DO block to safely handle cases where roles don't exist yet.

DO $$
BEGIN
  -- Revoke storytime_app privileges (if the role exists)
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'storytime_app') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM storytime_app';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM storytime_app';
    EXECUTE 'REVOKE ALL ON SCHEMA public FROM storytime_app';
    EXECUTE 'REVOKE CONNECT ON DATABASE storytime_prod FROM storytime_app';
    EXECUTE 'DROP ROLE storytime_app';
    RAISE NOTICE 'Dropped existing role: storytime_app';
  END IF;

  -- Revoke storytime_migrator privileges (if the role exists)
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'storytime_migrator') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM storytime_migrator';
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM storytime_migrator';
    EXECUTE 'REVOKE ALL ON SCHEMA public FROM storytime_migrator';
    EXECUTE 'REVOKE CONNECT ON DATABASE storytime_prod FROM storytime_migrator';
    EXECUTE 'DROP ROLE storytime_migrator';
    RAISE NOTICE 'Dropped existing role: storytime_migrator';
  END IF;
END
$$;

-- =============================================================================
-- PART 1: Create both roles first
-- =============================================================================
-- Both roles must exist before we can set cross-role default privileges.

-- CHANGE THIS PASSWORD before running. Use: openssl rand -base64 32
CREATE ROLE storytime_migrator WITH
  LOGIN
  PASSWORD 'CHANGE_ME_MIGRATOR_USE_openssl_rand_base64_32'
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT
  CONNECTION LIMIT 5;

-- CHANGE THIS PASSWORD before running. Use: openssl rand -base64 32
CREATE ROLE storytime_app WITH
  LOGIN
  PASSWORD 'CHANGE_ME_APP_USE_openssl_rand_base64_32'
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT
  CONNECTION LIMIT 20;

-- =============================================================================
-- PART 2: Migrator privileges (DDL + DML for migrations & seeding)
-- =============================================================================

GRANT CONNECT ON DATABASE storytime_prod TO storytime_migrator;

-- Full schema privileges: CREATE tables, types, indexes
GRANT CREATE, USAGE ON SCHEMA public TO storytime_migrator;

-- Full DML + DDL on all existing tables
GRANT ALL PRIVILEGES
  ON ALL TABLES IN SCHEMA public
  TO storytime_migrator;

-- Full sequence access
GRANT ALL PRIVILEGES
  ON ALL SEQUENCES IN SCHEMA public
  TO storytime_migrator;

-- Future objects created by the migrator are also owned by it
ALTER DEFAULT PRIVILEGES FOR ROLE storytime_migrator IN SCHEMA public
  GRANT ALL PRIVILEGES ON TABLES TO storytime_migrator;

ALTER DEFAULT PRIVILEGES FOR ROLE storytime_migrator IN SCHEMA public
  GRANT ALL PRIVILEGES ON SEQUENCES TO storytime_migrator;

-- =============================================================================
-- PART 3: Application user privileges (DML only — no schema changes)
-- =============================================================================

GRANT CONNECT ON DATABASE storytime_prod TO storytime_app;

-- Read-only schema access (can see tables, cannot create them)
GRANT USAGE ON SCHEMA public TO storytime_app;

-- DML on all existing tables (SELECT, INSERT, UPDATE, DELETE only)
GRANT SELECT, INSERT, UPDATE, DELETE
  ON ALL TABLES IN SCHEMA public
  TO storytime_app;

-- Sequence usage (required for @default(autoincrement()) / serial columns)
GRANT USAGE, SELECT
  ON ALL SEQUENCES IN SCHEMA public
  TO storytime_app;

-- =============================================================================
-- PART 4: Default privileges for future objects
-- =============================================================================
-- Prisma migrations run as storytime_migrator, so tables it creates must
-- automatically grant DML to storytime_app.

ALTER DEFAULT PRIVILEGES FOR ROLE storytime_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO storytime_app;

ALTER DEFAULT PRIVILEGES FOR ROLE storytime_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO storytime_app;

-- Also cover tables created by the superuser (postgres), in case migrations
-- are ever run as postgres instead of storytime_migrator.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO storytime_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO storytime_app;

-- =============================================================================
-- PART 5: Harden schema permissions
-- =============================================================================

-- Prevent inherited CREATE via PUBLIC (needed on PostgreSQL < 15)
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- Explicitly deny DDL for the app user
REVOKE CREATE ON SCHEMA public FROM storytime_app;

COMMIT;

-- =============================================================================
-- Verification (run these manually after the script succeeds):
-- =============================================================================
--
-- 1. Check both roles exist:
--    \du storytime_app
--    \du storytime_migrator
--
-- 2. App user CANNOT create tables:
--    SELECT has_schema_privilege('storytime_app', 'public', 'CREATE');
--      → false
--
-- 3. Migrator CAN create tables:
--    SELECT has_schema_privilege('storytime_migrator', 'public', 'CREATE');
--      → true
--
-- 4. After running migrations, app user CAN read/write data:
--    SELECT has_table_privilege('storytime_app', 'public."User"', 'SELECT');
--      → true
--
-- 5. After running migrations, app user CANNOT truncate:
--    SELECT has_table_privilege('storytime_app', 'public."User"', 'TRUNCATE');
--      → false
--
-- =============================================================================
