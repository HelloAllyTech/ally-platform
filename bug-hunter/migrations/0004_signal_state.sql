-- Bug Hunter v2 (chunk 08): signal cursors (last processed SHA, last poll time, log
-- baselines), the kill switch (`enabled`), and seen signal keys for dedupe.
DO $$ BEGIN
  -- Only when missing: in ally-be's database the schema is created by
  -- db/ally-db-setup.sql, and the agent's role has no CREATE on the database.
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'bughunter') THEN
    CREATE SCHEMA bughunter;
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS bughunter.signal_state (
    key        TEXT PRIMARY KEY,
    value      JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
