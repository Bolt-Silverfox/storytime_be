-- Backfill: mark all pre-migration users as having a local password.
-- Before this column existed, all users were created via email/password
-- registration (register() route) OR via OAuth with a randomly-generated
-- passwordHash. Both paths are indistinguishable in the DB alone.
-- Setting true for all existing rows is the safe default: it preserves the
-- previous behaviour where email was always counted as a linked provider,
-- and avoids incorrectly blocking users from unlinking OAuth accounts.
-- New users created after this migration have hasLocalPassword set explicitly
-- by the application: true from register(), false from OAuth signup.
UPDATE "users" SET "hasLocalPassword" = true;