import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `debrief_reporting.skill_observations`: one row per debrief run and skill the
 * Analyst judged, for the orchestrator's `query_aggregates` gateway tool
 * (cohort comparison, course patterns). Redacted like every view in the
 * schema: no quote, no note, no transcript; the learner only as a one-way key
 * so peers can be counted, never named. Groups under five learners are refused
 * in code (DebriefAggregatesService). A view, so nothing to backfill.
 */
export class CreateDebriefSkillObservationsView1981900720000 implements MigrationInterface {
  name = 'CreateDebriefSkillObservationsView1981900720000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS debrief_reporting`);
    await queryRunner.query(`
      CREATE OR REPLACE VIEW debrief_reporting.skill_observations AS
      SELECT r.id AS run_id,
             r."createdAt" AS created_at,
             r.tenant_id,
             COALESCE(t."isTestOrganization", false) AS is_test_org,
             r.mode, r.status,
             s."scenarioId" AS scenario_id,
             ti."trackId" AS track_id,
             md5('learner:' || s."counselorId"::text) AS learner_key,
             lower(trim(x->>'skill')) AS skill,
             (x->>'opportunity')::boolean AS opportunity,
             x->>'observation' AS observation
        FROM debrief_runs r
        JOIN scenario_sessions s ON s.id = r."scenarioSessionId"
        LEFT JOIN track_item_progress tip ON tip.id = s."trackItemProgressId"
        LEFT JOIN track_items ti ON ti.id = tip."trackItemId"
        LEFT JOIN tenants t ON t.id::text = r.tenant_id
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(r.workspace->'evidence'->'behaviours') = 'array'
               THEN r.workspace->'evidence'->'behaviours' ELSE '[]'::jsonb END
        ) x
       WHERE s."counselorId" IS NOT NULL
         AND COALESCE(trim(x->>'skill'), '') <> ''`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP VIEW IF EXISTS debrief_reporting.skill_observations`,
    );
  }
}
