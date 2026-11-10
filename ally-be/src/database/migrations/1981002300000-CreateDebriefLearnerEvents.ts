import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `debrief_learner_events` — what a learner did with a Debrief-agent debrief
 * (v9 FR-48 learner response, §3.3 experience metrics): opened, read through
 * the first "Work on this" card, listened, clicked "Practise this next",
 * answered the reflective question, replied to Ask Ally, waited on the
 * working screen and left before it was ready. One row per session, learner
 * and kind: the metrics count debriefs, not taps. `platform` is the app that
 * sent it (web/ios/android), for the per-device breakdown; server-side kinds
 * may leave it empty. Never any text the learner wrote.
 *
 * Also adds the view `debrief_reporting.learner_events` so the PM agent can
 * read these counts (same redaction rules as migration 1981002100000).
 *
 * Hand-written SQL, never `migration:generate`.
 */
export class CreateDebriefLearnerEvents1981002300000 implements MigrationInterface {
  name = 'CreateDebriefLearnerEvents1981002300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "debrief_learner_events" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "tenant_id" character varying,
        "runId" uuid,
        "scenarioSessionId" uuid NOT NULL,
        "userId" integer NOT NULL,
        "kind" character varying(32) NOT NULL,
        "platform" character varying(10),
        CONSTRAINT "PK_debrief_learner_events" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_debrief_learner_events_kind" CHECK ("kind" IN (
          'opened','read_through','listened','practise_next_click',
          'reflection_answered','replied','waited','left_before_ready')),
        CONSTRAINT "CHK_debrief_learner_events_platform" CHECK (
          "platform" IS NULL OR "platform" IN ('web','ios','android')),
        CONSTRAINT "FK_debrief_learner_events_run" FOREIGN KEY ("runId")
          REFERENCES "debrief_runs"("id") ON DELETE CASCADE
      )`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_debrief_learner_events_once"
        ON "debrief_learner_events" ("scenarioSessionId", "userId", "kind")`);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_debrief_learner_events_created"
        ON "debrief_learner_events" ("createdAt")`);
    await queryRunner.query(`
      CREATE OR REPLACE VIEW debrief_reporting.learner_events AS
      SELECT e."createdAt" AS created_at, e.tenant_id, e."runId" AS run_id,
             e.kind, e.platform
        FROM debrief_learner_events e`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP VIEW IF EXISTS debrief_reporting.learner_events`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "debrief_learner_events"`);
  }
}
