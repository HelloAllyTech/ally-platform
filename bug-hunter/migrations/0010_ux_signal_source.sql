-- The UX-signals scan files its bugs into Bug Hunter's queue (2026-11-23, when the old Bug
-- Hunter's engine was removed; it used to file them as old-style findings). Idempotent.

ALTER TABLE bughunter.bugs DROP CONSTRAINT IF EXISTS bugs_source_check;
ALTER TABLE bughunter.bugs ADD CONSTRAINT bugs_source_check CHECK (source IN (
  'reported', 'issue', 'ci_failure', 'error_log', 'commit_sweep', 'ux_signal'
));
