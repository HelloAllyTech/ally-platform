import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The debrief PM agent's foundations (v9 FR-50, FR-52, FR-59, FR-60, FR-61):
 *
 * - `debrief_owner_settings` — one row: every threshold the test ladder and
 *   the budgets use (FR-60), the baseline job's latest proposal beside them,
 *   and who changed them last. Defaults live in code; a key absent here means
 *   the default.
 * - `debrief_probe_results` — paired trials on production sessions: after a
 *   debrief is published, a challenger debrief nobody sees is written for the
 *   same session and both are judged blind (FR-58/FR-59).
 * - schema `debrief_reporting` — redacted views the PM agent may query with
 *   read-only SQL (owner-approved 2026-11-10, v9 item 63 / G-4). Counts,
 *   codes, scores, models, costs and times only: never `cards`, `workspace`,
 *   notes, transcripts or anything a learner wrote.
 *
 * Hand-written SQL, never `migration:generate`.
 */
export class CreateDebriefPmAgentFoundations1981002100000 implements MigrationInterface {
  name = 'CreateDebriefPmAgentFoundations1981002100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "debrief_owner_settings" (
        "id" integer NOT NULL DEFAULT 1,
        "values" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "proposal" jsonb,
        "proposedAt" TIMESTAMP,
        "updatedBy" integer,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_debrief_owner_settings" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_debrief_owner_settings_single" CHECK ("id" = 1)
      )`);
    await queryRunner.query(
      `INSERT INTO "debrief_owner_settings" ("id") VALUES (1) ON CONFLICT DO NOTHING`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "debrief_probe_results" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "tenant_id" character varying,
        "ideaId" uuid NOT NULL,
        "scenarioSessionId" uuid NOT NULL,
        "baselineRunId" uuid NOT NULL,
        "challengerRunId" uuid,
        "baselineOverall" numeric(5,2),
        "challengerOverall" numeric(5,2),
        "baselineHardFails" integer NOT NULL DEFAULT 0,
        "challengerHardFails" integer NOT NULL DEFAULT 0,
        "costUsd" numeric(10,4) NOT NULL DEFAULT 0,
        "status" character varying(12) NOT NULL,
        CONSTRAINT "PK_debrief_probe_results" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_debrief_probe_results_idea_session" UNIQUE ("ideaId", "scenarioSessionId"),
        CONSTRAINT "CHK_debrief_probe_results_status" CHECK ("status" IN ('done','unscored','failed'))
      )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_debrief_probe_results_idea" ON "debrief_probe_results" ("ideaId", "createdAt")`,
    );

    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS debrief_reporting`);
    await queryRunner.query(`
      CREATE OR REPLACE VIEW debrief_reporting.runs AS
      SELECT r.id,
             r."createdAt" AS created_at,
             r.tenant_id,
             COALESCE(t."isTestOrganization", false) AS is_test_org,
             r.mode, r.status, r."skipReason" AS skip_reason,
             r."recipeKey" AS recipe, r."releaseVersion" AS release_version,
             r."experimentId" AS experiment_id, r.arm,
             r.language, r."learnerTurns" AS learner_turns,
             r."hasRiskCue" AS has_risk_cue, r."learnerDistress" AS learner_distress,
             r."fallbackRung" AS fallback_rung, r."revisionRounds" AS revision_rounds,
             r."ceilingUsd" AS ceiling_usd, r."estimatedCostUsd" AS estimated_cost_usd,
             r."actualCostUsd" AS actual_cost_usd,
             r."evaluatorOverall" AS evaluator_overall,
             NULLIF(r.workspace->'judge'->>'overall', '')::numeric AS judge_overall,
             ARRAY(SELECT h->>'code' FROM jsonb_array_elements(COALESCE(r.workspace->'judge'->'hardFails', '[]'::jsonb)) h) AS judge_hard_fails,
             ARRAY(SELECT h->>'code' FROM jsonb_array_elements(COALESCE(r."evaluatorHardFails", '[]'::jsonb)) h) AS evaluator_hard_fails,
             ARRAY(SELECT c->>'code' FROM jsonb_array_elements(COALESCE(r."checkFailures", '[]'::jsonb)) c) AS check_failures,
             EXTRACT(EPOCH FROM (r."finishedAt" - r."startedAt"))::numeric AS seconds,
             COALESCE((r.workspace->>'resumes')::int, 0) AS resumes,
             r.workspace->>'languageSource' AS language_source
        FROM debrief_runs r
        LEFT JOIN tenants t ON t.id::text = r.tenant_id`);
    await queryRunner.query(`
      CREATE OR REPLACE VIEW debrief_reporting.steps AS
      SELECT r.id AS run_id, r."createdAt" AS created_at, r.mode,
             s->>'step' AS step, s->>'status' AS status, s->>'model' AS model,
             NULLIF(s->>'ms', '')::numeric AS ms,
             NULLIF(s->>'estimatedUsd', '')::numeric AS estimated_usd,
             NULLIF(s->>'round', '')::int AS round
        FROM debrief_runs r, jsonb_array_elements(COALESCE(r.steps, '[]'::jsonb)) s`);
    await queryRunner.query(`
      CREATE OR REPLACE VIEW debrief_reporting.judge_scores AS
      SELECT r.id AS run_id, r."createdAt" AS created_at, r.mode, r.language,
             r."recipeKey" AS recipe, r."releaseVersion" AS release_version,
             d->>'dimension' AS dimension, NULLIF(d->>'score', '')::numeric AS score
        FROM debrief_runs r,
             jsonb_array_elements(COALESCE(r.workspace->'judge'->'dimensions', '[]'::jsonb)) d`);
    await queryRunner.query(`
      CREATE OR REPLACE VIEW debrief_reporting.learner_responses AS
      SELECT f."runId" AS run_id, f."createdAt" AS created_at, f.tenant_id,
             f.kind, f.helpful, f.section, f.reason, f.urgent, f.status
        FROM debrief_run_feedback f`);
    await queryRunner.query(`
      CREATE OR REPLACE VIEW debrief_reporting.ideas AS
      SELECT l.id, l."createdAt" AS created_at, l."updatedAt" AS updated_at,
             l.status, l.change->>'ideaKind' AS idea_kind,
             l.change->>'promptCode' AS prompt_code, l.change->>'settingKey' AS setting_key,
             l.text, l."releaseId" AS release_id,
             (l.evidence->'screen'->>'lift')::numeric AS quick_test_lift,
             (l.evidence->'screen'->>'passed')::boolean AS quick_test_passed,
             (l.evidence->'gate'->>'passed')::boolean AS gate_passed,
             l.evidence->'trial'->>'status' AS trial_status,
             l.evidence->'canary'->>'status' AS canary_status
        FROM agent_lessons l
       WHERE l."agentKey" = 'debrief'`);
    await queryRunner.query(`
      CREATE OR REPLACE VIEW debrief_reporting.probes AS
      SELECT p.id, p."createdAt" AS created_at, p.tenant_id, p."ideaId" AS idea_id,
             p."baselineOverall" AS baseline_overall,
             p."challengerOverall" AS challenger_overall,
             p."baselineHardFails" AS baseline_hard_fails,
             p."challengerHardFails" AS challenger_hard_fails,
             p."costUsd" AS cost_usd, p.status
        FROM debrief_probe_results p`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP SCHEMA IF EXISTS debrief_reporting CASCADE`);
    await queryRunner.query(`DROP TABLE IF EXISTS "debrief_probe_results"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "debrief_owner_settings"`);
  }
}
