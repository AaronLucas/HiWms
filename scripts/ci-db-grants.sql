-- CI-only privilege fixup — NOT a DBA-owned migration, not applied to production.
--
-- Supabase Cloud provisions role grants (anon/authenticated/service_role on public
-- schema objects) automatically as part of its managed dashboard/provisioning flow.
-- A bare `supabase start` + `supabase db reset` on a fresh local/CI Postgres does not
-- replicate that step, so tables created by the raw migration SQL (which contains no
-- GRANT statements — confirmed via grep across supabase/migrations/*.sql) end up with
-- zero privileges for service_role/authenticated/anon on a brand-new instance.
--
-- This script is applied by .github/workflows/db-integration.yml (and can be applied
-- locally the same way) strictly to make the CI/local sandbox reproducible; it changes
-- nothing about the schema itself and must never be treated as a substitute for an
-- actual DBA migration.

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
