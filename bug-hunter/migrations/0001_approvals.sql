-- Bug Hunter v2: pending human approvals (spec §13a). Lives in the bughunter database,
-- never in ally-be's. Applied by `bug-hunter db migrate`.
CREATE SCHEMA IF NOT EXISTS bughunter;
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
