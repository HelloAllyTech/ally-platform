-- Read-only preview of what the Skills Store migrations will do to a database,
-- run BEFORE deploying them (e.g. against production through the usual
-- read-only path). Changes nothing: every statement is a SELECT.
--
--   psql "$DATABASE_URL" -f scripts/prompts/migration-preview.sql
--
-- The rule (1980200000000-SkillsStoreVersioning): every prompt's current
-- version in the store stays live. 1980150000000 snapshots the prompt tables
-- first, so nothing below is lost.
--
-- 1. Prompts whose RUNNING text changes: the override was off, so services ran
--    the file text (`defaultPrompt`), and the current version differs from it.
--    After the deploy they run the current version.
SELECT 'runs current version instead of file' AS action,
       p."promptCode",
       'v' || p."currentVersion" AS current_version,
       live."createdAt" AS current_saved_at,
       length(live.prompt) AS current_chars,
       length(p."defaultPrompt") AS file_chars
  FROM prompts p
  JOIN prompts_versions live
    ON live."promptId" = p.id AND live.version = p."currentVersion"
 WHERE p."useDashboardOverride" = false
   AND btrim(COALESCE(live.prompt, '')) <> ''
   AND btrim(live.prompt) <> btrim(COALESCE(p."defaultPrompt", ''))
 ORDER BY p."promptCode";

-- 2. Prompts with no usable current version: their default text is published
--    so they have one.
SELECT 'publish default (no usable version)' AS action,
       p."promptCode",
       length(p."defaultPrompt") AS default_chars
  FROM prompts p
  LEFT JOIN prompts_versions live
    ON live."promptId" = p.id AND live.version = p."currentVersion"
 WHERE p."defaultPrompt" IS NOT NULL
   AND btrim(p."defaultPrompt") <> ''
   AND (live.id IS NULL OR btrim(COALESCE(live.prompt, '')) = '')
 ORDER BY p."promptCode";

-- 3. Totals.
SELECT count(*) FILTER (WHERE "useDashboardOverride" = false) AS override_off,
       count(*) FILTER (WHERE "useDashboardOverride" = true) AS override_on,
       count(*) AS prompts
  FROM prompts;
SELECT count(*) AS translation_rows,
       count(*) FILTER (WHERE status = 'ready') AS ready
  FROM prompt_translations;
