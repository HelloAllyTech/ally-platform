-- Chunk 11: PR actions, like the old Bug Hunter. A bug can now have a draft PR
-- (opened by the strict gate, or by an admin's Open PR), be merged and be released.
-- Board tabs: pr_open -> In progress (the PR is still Bug Hunter's case, as in v1),
-- merged and released -> Done. Idempotent.

ALTER TABLE bughunter.bugs ADD COLUMN IF NOT EXISTS pr_url text;
ALTER TABLE bughunter.bugs ADD COLUMN IF NOT EXISTS pr_number integer;
ALTER TABLE bughunter.bugs ADD COLUMN IF NOT EXISTS pr_opened_at timestamptz;
ALTER TABLE bughunter.bugs ADD COLUMN IF NOT EXISTS pr_opened_by text;  -- 'agent' | 'admin'
ALTER TABLE bughunter.bugs ADD COLUMN IF NOT EXISTS merged_at timestamptz;
ALTER TABLE bughunter.bugs ADD COLUMN IF NOT EXISTS merged_by integer;
ALTER TABLE bughunter.bugs ADD COLUMN IF NOT EXISTS released_at timestamptz;
ALTER TABLE bughunter.bugs ADD COLUMN IF NOT EXISTS released_by integer;
ALTER TABLE bughunter.bugs ADD COLUMN IF NOT EXISTS release_tag text;
ALTER TABLE bughunter.bugs ADD COLUMN IF NOT EXISTS dismissed_reason text;

ALTER TABLE bughunter.bugs DROP CONSTRAINT IF EXISTS bugs_status_check;
ALTER TABLE bughunter.bugs ADD CONSTRAINT bugs_status_check CHECK (status IN (
  'backlog', 'queued', 'running', 'needs_you', 'pr_open', 'merged', 'released',
  'failed', 'done'
));
CREATE INDEX IF NOT EXISTS bugs_pr_opened ON bughunter.bugs (pr_opened_at)
  WHERE pr_opened_at IS NOT NULL;

-- What an admin asked for that needs git and GitHub; the worker takes pending rows.
CREATE TABLE IF NOT EXISTS bughunter.actions (
  id bigserial PRIMARY KEY,
  bug_id bigint NOT NULL REFERENCES bughunter.bugs (id),
  kind text NOT NULL CHECK (kind IN ('open_pr')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'failed')),
  requested_by integer,
  result text,                           -- the PR URL, or why it failed
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
-- one pending action of a kind per bug: a second click is a no-op
CREATE UNIQUE INDEX IF NOT EXISTS actions_one_pending
  ON bughunter.actions (bug_id, kind) WHERE status = 'pending';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bughunter_dashboard') THEN
    GRANT SELECT ON bughunter.actions TO bughunter_dashboard;
    GRANT INSERT (bug_id, kind, requested_by) ON bughunter.actions TO bughunter_dashboard;
    GRANT USAGE ON SEQUENCE bughunter.actions_id_seq TO bughunter_dashboard;
    -- Dismiss, Merge and Release are ally-be's clicks
    GRANT UPDATE (dismissed_reason, merged_at, merged_by, released_at, released_by,
                  release_tag)
      ON bughunter.bugs TO bughunter_dashboard;
  END IF;
END $$;
