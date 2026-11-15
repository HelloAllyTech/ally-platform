-- Bug Hunter v2: the daily model-spend ledger (chunk 08), shared by the daily service
-- on the VM and any machine with BUGHUNTER_SPEND_BACKEND=db. The day rolls over at
-- midnight IST (computed in code from `at`).
CREATE SCHEMA IF NOT EXISTS bughunter;
CREATE TABLE IF NOT EXISTS bughunter.spend (
    id      BIGSERIAL PRIMARY KEY,
    at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    usd     NUMERIC(10, 4) NOT NULL,
    source  TEXT NOT NULL,   -- daily | local-run | local-eval | github | estimate
    note    TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS spend_at_idx ON bughunter.spend (at);
