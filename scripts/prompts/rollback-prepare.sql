-- Run BEFORE starting a pre-Skills-Store ally-be (<= v1.157.x) on a database
-- the Skills Store migrations have run on. Rehearsed on a copy of production
-- prompt data on 2026-10-26.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/prompts/rollback-prepare.sql
--
-- Why: the old code upserts a translation with ON CONFLICT ("promptId",
-- "languageId"). The Skills Store keys translations by ("promptId",
-- "languageId", "sourceHash") so a draft can be translated before it goes
-- live, and Postgres refuses an ON CONFLICT target with no matching unique
-- index: every translation write fails (DATABASE_ERROR).
--
-- What it does, losing nothing:
--   1. Moves every translation row except one per prompt and language into
--      prompt_translations_archived_at_rollback. The kept row is the one for
--      the live text; failing that, the newest.
--   2. Adds the unique index the old code's upsert needs.
--
-- Everything else needs no preparation. The old code serves each prompt's
-- currentVersion (every override flag is on), which is the same text, and it
-- ignores the new columns and tables. The old sync rewrites `defaultPrompt` on
-- prompts whose dashboard text differs from its files; those values are the
-- pre-cutover defaults, kept in prompts_snapshot_pre_skills_store.
--
-- To return to the Skills Store afterwards: roll-forward-after-rollback.sql.
BEGIN;

CREATE TABLE IF NOT EXISTS prompt_translations_archived_at_rollback
  (LIKE prompt_translations);

WITH live AS (
  SELECT p.id AS "promptId",
         encode(sha256(convert_to(btrim(v.prompt, E' \t\n\r\f\v'), 'UTF8')), 'hex') AS hash
    FROM prompts p
    JOIN prompts_versions v
      ON v."promptId" = p.id AND v.version = p."currentVersion"
),
ranked AS (
  SELECT t.id,
         row_number() OVER (
           PARTITION BY t."promptId", t."languageId"
           ORDER BY (t."sourceHash" = live.hash) DESC NULLS LAST,
                    t."updatedAt" DESC, t.id
         ) AS rank
    FROM prompt_translations t
    LEFT JOIN live ON live."promptId" = t."promptId"
),
moved AS (
  DELETE FROM prompt_translations t
   USING ranked r
   WHERE r.id = t.id AND r.rank > 1
  RETURNING t.*
)
INSERT INTO prompt_translations_archived_at_rollback SELECT * FROM moved;

CREATE UNIQUE INDEX IF NOT EXISTS uq_prompt_translations_prompt_language_rollback
  ON prompt_translations ("promptId", "languageId");

COMMIT;

SELECT (SELECT count(*) FROM prompt_translations) AS translations_kept,
       (SELECT count(*) FROM prompt_translations_archived_at_rollback) AS translations_archived;
