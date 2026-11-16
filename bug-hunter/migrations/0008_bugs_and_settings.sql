-- Chunk 10: the three modes (off | manual | autonomous) and one queue for every bug,
-- whatever its source, which is also the dashboard's board (Needs you, Failed,
-- In progress, Backlog, Done). Idempotent, like every migration here.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'bughunter') THEN
    CREATE SCHEMA bughunter;
  END IF;
END $$;

-- One row (id = 1). Off by default: nothing is collected or run until an admin picks
-- manual or autonomous in the dashboard.
CREATE TABLE IF NOT EXISTS bughunter.settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  mode text NOT NULL DEFAULT 'off' CHECK (mode IN ('off', 'manual', 'autonomous')),
  daily_run_limit integer NOT NULL DEFAULT 10 CHECK (daily_run_limit BETWEEN 0 AND 50),
  updated_by integer,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO bughunter.settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- status: backlog (not started) -> queued (an admin pressed Start fix, or retry) ->
-- running -> needs_you (suggested fix or escalation waiting for a verdict) | failed |
-- done (verdict given, no bug, duplicate). `reason` says why a bug waits or failed.
CREATE TABLE IF NOT EXISTS bughunter.bugs (
  id bigserial PRIMARY KEY,
  source text NOT NULL
    CHECK (source IN ('reported', 'issue', 'ci_failure', 'error_log', 'commit_sweep')),
  signal_key text NOT NULL,              -- the dedupe key ("reported:<uuid>", "ci:<run>")
  app text,                              -- null until known (a reported bug may not say)
  title text NOT NULL,
  description text NOT NULL DEFAULT '',  -- as reported; scrubbed before any model sees it
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,  -- the Candidate fields the worker needs
  reported_by text NOT NULL DEFAULT 'user',
  status text NOT NULL DEFAULT 'backlog'
    CHECK (status IN ('backlog', 'queued', 'running', 'needs_you', 'failed', 'done')),
  reason text,
  run_id text,
  report_id bigint REFERENCES bughunter.reports (id),
  attempts integer NOT NULL DEFAULT 0,
  queued_by integer,                     -- ally-be user id that pressed Start fix / Retry
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  UNIQUE (signal_key)
);
CREATE INDEX IF NOT EXISTS bugs_status_created ON bughunter.bugs (status, created_at);
CREATE INDEX IF NOT EXISTS bugs_report ON bughunter.bugs (report_id);

-- ally-be's access (the group role from db/ally-db-setup.sql): read both tables, file a
-- reported bug, press Start fix / Retry, set the mode, and close a bug on a verdict.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bughunter_dashboard') THEN
    GRANT SELECT ON bughunter.settings, bughunter.bugs TO bughunter_dashboard;
    GRANT UPDATE (mode, updated_by, updated_at) ON bughunter.settings TO bughunter_dashboard;
    GRANT INSERT (source, signal_key, app, title, description, payload, reported_by)
      ON bughunter.bugs TO bughunter_dashboard;
    GRANT UPDATE (status, app, reason, queued_by, updated_at, finished_at)
      ON bughunter.bugs TO bughunter_dashboard;
    GRANT USAGE ON SEQUENCE bughunter.bugs_id_seq TO bughunter_dashboard;
  END IF;
END $$;

-- Reports filed before the queue existed get a board row, so nothing already reported
-- disappears from the dashboard: judged -> done, waiting for a verdict -> needs_you,
-- anything else -> done (it never needed a human).
INSERT INTO bughunter.bugs
  (source, signal_key, app, title, status, run_id, report_id, reported_by,
   created_at, started_at, finished_at)
SELECT
  CASE WHEN r.source IN ('reported', 'issue', 'ci_failure', 'error_log', 'commit_sweep')
       THEN r.source ELSE 'issue' END,
  r.signal_key, r.app, r.title,
  CASE
    WHEN EXISTS (SELECT 1 FROM bughunter.verdicts v
                  WHERE v.report_id = r.id AND v.superseded_by IS NULL) THEN 'done'
    WHEN r.status IN ('suggested_fix', 'escalated') THEN 'needs_you'
    ELSE 'done'
  END,
  -- started_at stays empty: the worker never ran these, so they must not count
  -- against today's run limit
  r.run_id, r.id, 'agent', r.created_at, NULL, r.created_at
FROM bughunter.reports r
WHERE NOT EXISTS (SELECT 1 FROM bughunter.bugs b WHERE b.report_id = r.id)
ON CONFLICT (signal_key) DO NOTHING;
