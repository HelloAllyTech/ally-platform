-- Bug Hunter v2: human verdicts on a run (chunk 07). Two parts plus a reason:
-- diagnosis correct | wrong | not_a_bug; fix worked | needed_edits | wrong | none.
-- Written by `bug-hunter verdict` now and by the admin dashboard in chunk 09.
-- `bug-hunter feedback` turns unapplied rows into long-term memory.
CREATE SCHEMA IF NOT EXISTS bughunter;
CREATE TABLE IF NOT EXISTS bughunter.verdicts (
    id          BIGSERIAL PRIMARY KEY,
    run_id      TEXT NOT NULL,
    app         TEXT NOT NULL,
    diagnosis   TEXT NOT NULL CHECK (diagnosis IN ('correct', 'wrong', 'not_a_bug')),
    fix         TEXT NOT NULL CHECK (fix IN ('worked', 'needed_edits', 'wrong', 'none')),
    reason      TEXT NOT NULL,
    decided_by  TEXT NOT NULL,
    source      TEXT NOT NULL DEFAULT 'cli',  -- cli | dashboard | github | simulated
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    applied_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS verdicts_unapplied_idx ON bughunter.verdicts (applied_at)
    WHERE applied_at IS NULL;
CREATE INDEX IF NOT EXISTS verdicts_run_idx ON bughunter.verdicts (run_id);
