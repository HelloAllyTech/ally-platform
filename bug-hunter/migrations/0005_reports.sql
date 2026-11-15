-- Bug Hunter v2 (chunk 08): one row per daily-service outcome (suggested fix,
-- escalation, no bug, skipped). The private reports repo gets an issue for the ones
-- a human should read; nothing about findings goes to the public ally-platform repo.
CREATE SCHEMA IF NOT EXISTS bughunter;
CREATE TABLE IF NOT EXISTS bughunter.reports (
    id            BIGSERIAL PRIMARY KEY,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    day           DATE NOT NULL,              -- ledger day (IST)
    run_id        TEXT,
    source        TEXT NOT NULL,              -- ci_failure | issue | error_log | commit_sweep
    app           TEXT NOT NULL,
    signal_key    TEXT NOT NULL,
    status        TEXT NOT NULL,              -- suggested_fix | escalated | closed_not_bug | ...
    title         TEXT NOT NULL,
    body_md       TEXT NOT NULL DEFAULT '',   -- scrubbed
    cost_usd      NUMERIC(10, 4) NOT NULL DEFAULT 0,
    private_issue TEXT                        -- URL in the private reports repo
);
CREATE INDEX IF NOT EXISTS reports_day_idx ON bughunter.reports (day);
CREATE INDEX IF NOT EXISTS reports_key_idx ON bughunter.reports (signal_key);
