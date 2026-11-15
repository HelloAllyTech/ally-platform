-- Bug Hunter v2 (chunk 08): signal cursors (last processed SHA, last poll time, log
-- baselines), the kill switch (`enabled`), and seen signal keys for dedupe.
CREATE SCHEMA IF NOT EXISTS bughunter;
CREATE TABLE IF NOT EXISTS bughunter.signal_state (
    key        TEXT PRIMARY KEY,
    value      JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
