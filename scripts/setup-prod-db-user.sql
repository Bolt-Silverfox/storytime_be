-- =============================================================================
-- Storytime Production Database User Setup
-- =============================================================================
-- Run this script as the PostgreSQL superuser (e.g., postgres) on the
-- production database server ONCE before the first deployment.
--
-- Usage:
--   psql -h <host> -U postgres -d storytime_db -f scripts/setup-prod-db-user.sql
--
-- After running, set DATABASE_URL in your production .env / GitHub secret:
--   DATABASE_URL=postgresql://storytime_app:<PASSWORD>@<host>:5432/storytime_db?schema=public
-- =============================================================================

-- 1. Create the application user with a strong password.
--    CHANGE THIS PASSWORD before running. Use: openssl rand -base64 32
CREATE ROLE storytime_app WITH
  LOGIN
  PASSWORD 'CHANGE_ME_USE_openssl_rand_base64_32'
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT
  CONNECTION LIMIT 20;

-- 2. Grant CONNECT on the database (required to connect at all)
GRANT CONNECT ON DATABASE storytime_db TO storytime_app;

-- 3. Grant USAGE on the public schema (required to see tables)
GRANT USAGE ON SCHEMA public TO storytime_app;

-- 4. Grant DML-only privileges on ALL existing tables
--    (SELECT, INSERT, UPDATE, DELETE — no DROP, TRUNCATE, ALTER, CREATE)
GRANT SELECT, INSERT, UPDATE, DELETE
  ON ALL TABLES IN SCHEMA public
  TO storytime_app;

-- 5. Grant sequence usage (required for auto-increment / serial columns)
GRANT USAGE, SELECT
  ON ALL SEQUENCES IN SCHEMA public
  TO storytime_app;

-- 6. Set default privileges so FUTURE tables/sequences created by the
--    superuser (via Prisma migrations) are automatically accessible.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO storytime_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO storytime_app;

-- 7. Explicitly deny schema-level DDL (belt and suspenders — the role
--    already lacks CREATEDB/CREATEROLE, but this prevents CREATE TABLE
--    even if someone later grants broader schema permissions).
REVOKE CREATE ON SCHEMA public FROM storytime_app;

-- =============================================================================
-- Verification: run these after the script to confirm
-- =============================================================================
-- \du storytime_app
--   Should show: No superuser, No create DB, No create role, Conn limit 20
--
-- SELECT has_schema_privilege('storytime_app', 'public', 'CREATE');
--   Should return: false
--
-- SELECT has_table_privilege('storytime_app', 'public."User"', 'SELECT');
--   Should return: true
--
-- SELECT has_table_privilege('storytime_app', 'public."User"', 'TRUNCATE');
--   Should return: false
-- =============================================================================
