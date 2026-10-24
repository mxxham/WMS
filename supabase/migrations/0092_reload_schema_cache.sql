-- Same DDL as 0091 (create-or-replace is idempotent), applied via the
-- migration endpoint so the hosted PostgREST schema cache reloads; the CLI
-- push alone left the new views invisible to the REST API ("schema cache").
-- Recorded on the project through apply_migration 2026-10-25.
notify pgrst, 'reload schema';
