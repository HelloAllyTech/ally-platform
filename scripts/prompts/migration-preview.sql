-- Read-only preview of what migration 1980200000000-SkillsStoreVersioning will
-- do to a database, run BEFORE deploying it (e.g. against production through
-- the usual read-only path). Changes nothing: every statement is a SELECT.
--
--   psql "$DATABASE_URL" -f scripts/prompts/migration-preview.sql
--
-- 1. Prompts served from their file today, whose file text gets published as a
--    new live version. "first version" = the row had no live version at all.
--    Includes dashboard rows with no live text: they fell back to the file.
SELECT 'publish file text' AS action,
       p."promptCode",
       CASE WHEN live.id IS NULL THEN 'first version'
            ELSE 'v' || live.version || ' -> v' || (COALESCE(mx.max_version, 0) + 1) END AS change,
       length(p."defaultPrompt") AS file_chars,
       length(live.prompt) AS stale_live_chars
  FROM prompts p
  LEFT JOIN prompts_versions live
    ON live."promptId" = p.id AND live.version = p."currentVersion"
  LEFT JOIN (SELECT "promptId", MAX(version) AS max_version
               FROM prompts_versions GROUP BY "promptId") mx
    ON mx."promptId" = p.id
 WHERE p."defaultPrompt" IS NOT NULL
   AND btrim(p."defaultPrompt") <> ''
   AND (
     (p."useDashboardOverride" = false
       AND (live.id IS NULL OR btrim(live.prompt) <> btrim(p."defaultPrompt")))
     OR
     (p."useDashboardOverride" = true
       AND (live.id IS NULL OR btrim(COALESCE(live.prompt, '')) = ''))
   )
 ORDER BY p."promptCode";

-- 2. Prompts served from the dashboard whose file text differs: the dashboard
--    text stays live (the store wins). `file_is_newer` = the file was synced
--    after the live version was saved — an edit in Git that never shipped,
--    which someone should look at before or after the deploy.
SELECT 'keep dashboard text' AS action,
       p."promptCode",
       'v' || p."currentVersion" AS live_version,
       live."createdAt" AS live_saved_at,
       p."updatedAt" AS file_synced_at,
       p."updatedAt" > live."createdAt" AS file_is_newer
  FROM prompts p
  JOIN prompts_versions live
    ON live."promptId" = p.id AND live.version = p."currentVersion"
 WHERE p."useDashboardOverride" = true
   AND p."defaultPrompt" IS NOT NULL
   AND btrim(live.prompt) <> ''
   AND btrim(live.prompt) <> btrim(p."defaultPrompt")
 ORDER BY file_is_newer DESC, p."promptCode";

-- 3. Totals.
SELECT count(*) FILTER (WHERE "useDashboardOverride" = false) AS served_from_file,
       count(*) FILTER (WHERE "useDashboardOverride" = true) AS served_from_dashboard,
       count(*) AS prompts
  FROM prompts;
SELECT count(*) AS translation_rows,
       count(*) FILTER (WHERE status = 'ready') AS ready
  FROM prompt_translations;
