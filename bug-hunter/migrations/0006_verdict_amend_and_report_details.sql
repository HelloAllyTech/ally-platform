-- Bug Hunter v2 (chunk 09).
-- Verdicts can be amended: the new row is the active one; the old row is kept and
-- points at it (superseded_by, superseded_at). report_id links a verdict to the
-- dashboard report it judges (run_id may be empty for human-only escalations).
ALTER TABLE bughunter.verdicts ADD COLUMN IF NOT EXISTS report_id BIGINT;
ALTER TABLE bughunter.verdicts ADD COLUMN IF NOT EXISTS superseded_by BIGINT;
ALTER TABLE bughunter.verdicts ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ;
ALTER TABLE bughunter.verdicts ADD COLUMN IF NOT EXISTS retracted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS verdicts_report_idx ON bughunter.verdicts (report_id);
-- one active verdict per report
CREATE UNIQUE INDEX IF NOT EXISTS verdicts_one_active_per_report
    ON bughunter.verdicts (report_id) WHERE superseded_by IS NULL AND report_id IS NOT NULL;

-- What the dashboard shows for each report, all scrubbed by the bug hunter.
ALTER TABLE bughunter.reports ADD COLUMN IF NOT EXISTS finding JSONB;          -- title, category, severity, hypothesis, evidence, files
ALTER TABLE bughunter.reports ADD COLUMN IF NOT EXISTS root_cause TEXT;
ALTER TABLE bughunter.reports ADD COLUMN IF NOT EXISTS repro JSONB;            -- test_path, test_name, source, failure_excerpt
ALTER TABLE bughunter.reports ADD COLUMN IF NOT EXISTS patch_diff TEXT;
ALTER TABLE bughunter.reports ADD COLUMN IF NOT EXISTS review JSONB;           -- verdict, notes, counterexamples, disputed
ALTER TABLE bughunter.reports ADD COLUMN IF NOT EXISTS confidence TEXT;
ALTER TABLE bughunter.reports ADD COLUMN IF NOT EXISTS risk_level TEXT;
ALTER TABLE bughunter.reports ADD COLUMN IF NOT EXISTS stop_reason TEXT;
ALTER TABLE bughunter.reports ADD COLUMN IF NOT EXISTS severity TEXT;
