import { TrackItemType } from '../type/track.type';

/**
 * Trigger warnings per item: a roleplay's own scenario, or every scenario in
 * a case. The landing page's equivalent groups by chapter; the Conductor
 * needs them per item for tension and atmosphere, and the course builder's
 * Ally notes show the tension they imply.
 */
export const TRACK_TRIGGER_WARNINGS_BY_ITEM_SQL = `
  WITH item_scenarios AS (
    SELECT ti."id" AS "itemId", ti."scenarioId" AS "scenarioId"
    FROM "track_items" ti
    WHERE ti."trackId" = $1::uuid
      AND ti."deletedAt" IS NULL
      AND ti."type" = '${TrackItemType.ROLEPLAY}'
      AND ti."scenarioId" IS NOT NULL
    UNION ALL
    SELECT ti."id", ci."scenarioId"
    FROM "track_items" ti
    JOIN "case_items" ci
      ON ci."caseId" = ti."caseId" AND ci."deletedAt" IS NULL
    WHERE ti."trackId" = $1::uuid
      AND ti."deletedAt" IS NULL
      AND ti."type" = '${TrackItemType.CASE}'
  )
  SELECT DISTINCT s."itemId" AS "itemId", tw."name" AS "name"
  FROM item_scenarios s
  JOIN "scenario_trigger_warnings" stw ON stw."scenarioId" = s."scenarioId"
  JOIN "trigger_warnings" tw ON tw."id" = stw."triggerWarningId"
`;
