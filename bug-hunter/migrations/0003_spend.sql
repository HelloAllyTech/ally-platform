-- Bug Hunter v2: the daily model-spend ledger (chunk 08), shared by the daily service
-- on the VM and any machine with BUGHUNTER_SPEND_BACKEND=db. The day rolls over at
-- midnight IST (computed in code from `at`).
DO $$ BEGIN
  -- Only when missing: in ally-be's database the schema is created by
  -- db/ally-db-setup.sql, and the agent's role has no CREATE on the database.
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'bughunter') THEN
    CREATE SCHEMA bughunter;
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS bughunter.spend (
    id      BIGSERIAL PRIMARY KEY,
    at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    usd     NUMERIC(10, 4) NOT NULL,
    source  TEXT NOT NULL,   -- daily | local-run | local-eval | github | estimate
    note    TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS spend_at_idx ON bughunter.spend (at);
