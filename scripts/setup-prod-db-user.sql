-- =============================================================================
-- Storytime Production Database User Setup
-- =============================================================================
-- Creates TWO database users with separate concerns:
--
--   storytime_migrator  — runs Prisma migrations & seeding (full DDL + DML)
--   storytime_app       — runtime application user (DML only)
--
-- Run this script ONCE as the PostgreSQL superuser (e.g., postgres) on the
-- production database server before the first deployment.
--
-- Usage:
--   psql -h <host> -U postgres -d storytime_db -f scripts/setup-prod-db-user.sql
--
-- After running, set these in your production .env / GitHub secrets:
--   DATABASE_URL=postgresql://storytime_app:<APP_PASSWORD>@<host>:5432/storytime_db?schema=public
--   MIGRATE_DATABASE_URL=postgresql://storytime_migrator:<MIGRATOR_PASSWORD>@<host>:5432/storytime_db?schema=public
--
-- Deployment workflow:
--   1. Run migrations with MIGRATE_DATABASE_URL:
--      DATABASE_URL=$MIGRATE_DATABASE_URL npx prisma migrate deploy
--   2. Seed with MIGRATE_DATABASE_URL:
--      DATABASE_URL=$MIGRATE_DATABASE_URL pnpm db:seed
--   3. Start the app with DATABASE_URL (storytime_app)
-- =============================================================================

-- =============================================================================
-- PART 1: Migration User (storytime_migrator)
-- =============================================================================
-- This user runs Prisma migrations and seeding. It needs full DDL + DML
-- to CREATE/ALTER/DROP tables, manage the _prisma_migrations table, and
-- seed data. It should NEVER be used as the runtime DATABASE_URL.

-- CHANGE THIS PASSWORD before running. Use: openssl rand -base64 32
CREATE ROLE storytime_migrator WITH
  LOGIN
  PASSWORD 'CHANGE_ME_MIGRATOR_USE_openssl_rand_base64_32'
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT
  CONNECTION LIMIT 5;

-- Allow connecting to the database
GRANT CONNECT ON DATABASE storytime_db TO storytime_migrator;

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

-- Ensure migrator can also manage future objects it creates
ALTER DEFAULT PRIVILEGES FOR ROLE storytime_migrator IN SCHEMA public
  GRANT ALL PRIVILEGES ON TABLES TO storytime_migrator;

ALTER DEFAULT PRIVILEGES FOR ROLE storytime_migrator IN SCHEMA public
  GRANT ALL PRIVILEGES ON SEQUENCES TO storytime_migrator;

-- =============================================================================
-- PART 2: Application User (storytime_app)
-- =============================================================================
-- This user is used at runtime by the NestJS app. It can ONLY read/write
-- data — no schema changes. If these credentials are exposed, attackers
-- cannot DROP tables, ALTER columns, or destroy the database structure.

-- CHANGE THIS PASSWORD before running. Use: openssl rand -base64 32
CREATE ROLE storytime_app WITH
  LOGIN
  PASSWORD 'CHANGE_ME_APP_USE_openssl_rand_base64_32'
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT
  CONNECTION LIMIT 20;

-- Allow connecting to the database
GRANT CONNECT ON DATABASE storytime_db TO storytime_app;

-- Read-only schema access (can see tables, cannot create them)
GRANT USAGE ON SCHEMA public TO storytime_app;

-- DML-only on all existing tables
-- (SELECT, INSERT, UPDATE, DELETE — no DROP, TRUNCATE, ALTER, CREATE)
GRANT SELECT, INSERT, UPDATE, DELETE
  ON ALL TABLES IN SCHEMA public
  TO storytime_app;

-- Sequence usage (required for auto-increment / serial / @default(autoincrement()))
GRANT USAGE, SELECT
  ON ALL SEQUENCES IN SCHEMA public
  TO storytime_app;

-- Grant the app user access to tables/sequences created by the migrator
-- (this is critical — Prisma migrations run as storytime_migrator, so the
-- default privileges must also grant DML to storytime_app)
ALTER DEFAULT PRIVILEGES FOR ROLE storytime_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO storytime_app;

ALTER DEFAULT PRIVILEGES FOR ROLE storytime_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO storytime_app;

-- Default privileges for tables created by the superuser (postgres)
-- In case migrations are ever run as postgres instead of storytime_migrator
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO storytime_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO storytime_app;

-- Prevent inherited CREATE via PUBLIC on older/upgraded PostgreSQL databases
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- Explicitly deny schema-level DDL (belt and suspenders — the role
-- already lacks CREATEDB/CREATEROLE, but this prevents CREATE TABLE
-- even if someone later grants broader schema permissions)
REVOKE CREATE ON SCHEMA public FROM storytime_app;

-- =============================================================================
-- Verification: run these after the script to confirm
-- =============================================================================
--
-- 1. Check both roles exist with correct attributes:
--    \du storytime_app
--      → No superuser, No create DB, No create role, Conn limit 20
--    \du storytime_migrator
--      → No superuser, No create DB, No create role, Conn limit 5
--
-- 2. App user CANNOT create tables:
--    SELECT has_schema_privilege('storytime_app', 'public', 'CREATE');
--      → false
--
-- 3. Migrator CAN create tables:
--    SELECT has_schema_privilege('storytime_migrator', 'public', 'CREATE');
--      → true
--
-- 4. App user CAN read/write data:
--    SELECT has_table_privilege('storytime_app', 'public."User"', 'SELECT');
--      → true
--    SELECT has_table_privilege('storytime_app', 'public."User"', 'INSERT');
--      → true
--
-- 5. App user CANNOT truncate or drop:
--    SELECT has_table_privilege('storytime_app', 'public."User"', 'TRUNCATE');
--      → false
--
-- =============================================================================
