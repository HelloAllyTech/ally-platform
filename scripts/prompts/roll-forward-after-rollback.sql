-- Run BEFORE starting the Skills Store ally-be again after a rollback to a
-- pre-Skills-Store build (see rollback-prepare.sql). Rehearsed on a copy of
-- production prompt data on 2026-10-26.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v rolled_back_at="'2026-10-27 09:00:00+00'" \
--     -f scripts/prompts/roll-forward-after-rollback.sql
--
-- rolled_back_at: when the old build started serving (UTC), so only versions
-- it saved are touched.
--
-- What it does:
--   1. Drops the unique index rollback-prepare.sql added: the Skills Store keeps
--      one translation per prompt, language and source text.
--   2. Puts the archived translation rows back (none are lost).
--   3. Marks the versions the old build saved as published at the time they
--      were saved. The old code made every save live at once but doesn't know
--      `publishedAt`, so without this they would list as drafts.
--   4. Makes each prompt's stored default its live text again, as the cutover
--      did (the old sync wrote its file text into some of them).
BEGIN;

DROP INDEX IF EXISTS uq_prompt_translations_prompt_language_rollback;

DO $$
BEGIN
  IF to_regclass('prompt_translations_archived_at_rollback') IS NOT NULL THEN
    INSERT INTO prompt_translations
    SELECT a.* FROM prompt_translations_archived_at_rollback a
     WHERE NOT EXISTS (
       SELECT 1 FROM prompt_translations t
        WHERE t.id = a.id
           OR (t."promptId" = a."promptId" AND t."languageId" = a."languageId"
               AND t."sourceHash" = a."sourceHash"));
    DROP TABLE prompt_translations_archived_at_rollback;
  END IF;
END $$;

UPDATE prompts_versions
   SET "publishedAt" = "createdAt"
 WHERE "publishedAt" IS NULL
   AND "createdAt" >= :rolled_back_at::timestamptz;

UPDATE prompts p
   SET "defaultPrompt" = live.prompt
  FROM prompts_versions live
 WHERE live."promptId" = p.id
   AND live.version = p."currentVersion"
   AND btrim(COALESCE(live.prompt, '')) <> ''
   AND p."defaultPrompt" IS DISTINCT FROM live.prompt;

COMMIT;
