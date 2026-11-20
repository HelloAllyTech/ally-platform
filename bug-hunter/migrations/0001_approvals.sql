-- Bug Hunter v2: pending human approvals (spec §13a). Lives in the bughunter database,
-- never in ally-be's. Applied by `bug-hunter db migrate`.
DO $$ BEGIN
  -- Only when missing: in ally-be's database the schema is created by
  -- db/ally-db-setup.sql, and the agent's role has no CREATE on the database.
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'bughunter') THEN
    CREATE SCHEMA bughunter;
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS bughunter.approvals (
    id            TEXT PRIMARY KEY,            -- run id
    app           TEXT NOT NULL,
    title         TEXT NOT NULL,
    severity      TEXT NOT NULL,
    risk_level    TEXT NOT NULL,
    confidence    TEXT,
    root_cause    TEXT NOT NULL,
    repro_test    TEXT NOT NULL,
    files_changed TEXT[] NOT NULL DEFAULT '{}',
    pr_url        TEXT,
    ci_status     TEXT,
    status        TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected | expired
    decided_by    TEXT,
    decided_at    TIMESTAMPTZ,
    reason        TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at    TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS approvals_status_idx ON bughunter.approvals (status, created_at);
