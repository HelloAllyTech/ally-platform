import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The learning loop's second half (plans/ally-guide/plan.md §7.13 loop 2,
 * §7.12 synthetic monitoring), generic across agents like the rest of
 * `agent_*`:
 *
 *  - `agent_lessons` — every change the curator proposed (lessons, policy and
 *    prompt tweaks), including the ones a guardrail blocked or quarantined.
 *  - `agent_lesson_audit` — the curator's append-only audit: proposals,
 *    blocks, approvals, delegation stage changes, automatic pipeline steps.
 *  - `agent_delegation` — the progressive-delegation stage per agent (1–3).
 *  - `agent_shadow_reports` — a candidate replayed on recent real turns.
 *  - `agent_synthetic_runs` — nightly synthetic journeys on GA.
 *  - `agent_releases.changeSet` — what a curator release changed, and why.
 *
 * The release pipeline acts on its own from here, so release and audit rows
 * gain the `system` actor, and the audit gains the shadow and canary-decision
 * actions. Additive only; every CHECK is listed in
 * check-constraints-cover-enums.spec.ts.
 */
export class CreateAgentLearningLoopTables1980740000000 implements MigrationInterface {
  name = 'CreateAgentLearningLoopTables1980740000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "agent_lessons" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "agentKey" character varying(64) NOT NULL,
        "kind" character varying(12) NOT NULL DEFAULT 'lesson',
        "scope" character varying(12) NOT NULL,
        "tenant_id" character varying,
        "trackId" uuid,
        "status" character varying(12) NOT NULL DEFAULT 'proposed',
        "text" character varying(400) NOT NULL,
        "change" jsonb,
        "rationale" text,
        "evidence" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "blockReason" character varying(40),
        "releaseId" uuid,
        "contentHash" character varying(64) NOT NULL,
        "authorKind" character varying(16) NOT NULL,
        "decidedBy" integer,
        "decidedAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agent_lessons_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_agent_lessons_kind" CHECK ("kind" IN (
          'lesson', 'policy', 'prompt'
        )),
        CONSTRAINT "CHK_agent_lessons_scope" CHECK ("scope" IN (
          'platform', 'org', 'course'
        )),
        CONSTRAINT "CHK_agent_lessons_status" CHECK ("status" IN (
          'proposed', 'quarantined', 'approved', 'active', 'blocked', 'rejected', 'retired'
        )),
        CONSTRAINT "CHK_agent_lessons_author_kind" CHECK ("authorKind" IN (
          'seed', 'human', 'curator', 'system'
        )),
        CONSTRAINT "CHK_agent_lessons_scope_target" CHECK (
          ("scope" = 'platform' AND "tenant_id" IS NULL AND "trackId" IS NULL)
          OR ("scope" = 'org' AND "tenant_id" IS NOT NULL)
          OR ("scope" = 'course' AND "trackId" IS NOT NULL)
        )
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_agent_lessons_agent_status" ON "agent_lessons" ("agentKey", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_agent_lessons_release" ON "agent_lessons" ("releaseId")`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "agent_lesson_audit" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "agentKey" character varying(64) NOT NULL,
        "lessonId" uuid,
        "releaseId" uuid,
        "action" character varying(24) NOT NULL,
        "actorKind" character varying(16) NOT NULL,
        "actorUserId" integer,
        "detail" jsonb,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agent_lesson_audit_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_agent_lesson_audit_action" CHECK ("action" IN (
          'proposed', 'quarantined', 'blocked', 'approved', 'rejected', 'activated',
          'retired', 'curator_run', 'stage_changed', 'pipeline_step'
        )),
        CONSTRAINT "CHK_agent_lesson_audit_actor_kind" CHECK ("actorKind" IN (
          'seed', 'human', 'curator', 'system'
        ))
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_agent_lesson_audit_agent_created" ON "agent_lesson_audit" ("agentKey", "createdAt")`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "agent_delegation" (
        "agentKey" character varying(64) NOT NULL,
        "stage" smallint NOT NULL DEFAULT 1,
        "changedBy" integer,
        "reason" text,
        "changedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agent_delegation_agent_key" PRIMARY KEY ("agentKey"),
        CONSTRAINT "CHK_agent_delegation_stage" CHECK ("stage" BETWEEN 1 AND 3)
      )`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "agent_shadow_reports" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "agentKey" character varying(64) NOT NULL,
        "releaseId" uuid NOT NULL,
        "baselineReleaseId" uuid,
        "status" character varying(14) NOT NULL DEFAULT 'running',
        "turnCount" integer NOT NULL DEFAULT 0,
        "summary" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "costUsd" numeric(12,6) NOT NULL DEFAULT 0,
        "triggeredBy" integer,
        "completedAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agent_shadow_reports_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_agent_shadow_reports_status" CHECK ("status" IN (
          'running', 'passed', 'failed', 'inconclusive', 'error'
        ))
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_agent_shadow_reports_release" ON "agent_shadow_reports" ("releaseId", "createdAt")`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "agent_synthetic_runs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "agentKey" character varying(64) NOT NULL,
        "releaseId" uuid NOT NULL,
        "night" date NOT NULL,
        "status" character varying(12) NOT NULL DEFAULT 'running',
        "journeys" integer NOT NULL DEFAULT 0,
        "turns" integer NOT NULL DEFAULT 0,
        "passRate" real,
        "safetyFailures" integer NOT NULL DEFAULT 0,
        "drift" boolean NOT NULL DEFAULT false,
        "summary" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "costUsd" numeric(12,6) NOT NULL DEFAULT 0,
        "completedAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agent_synthetic_runs_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_agent_synthetic_runs_status" CHECK ("status" IN (
          'running', 'completed', 'error'
        ))
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_agent_synthetic_runs_agent_night" ON "agent_synthetic_runs" ("agentKey", "night")`,
    );

    await queryRunner.query(
      `ALTER TABLE "agent_releases" ADD COLUMN IF NOT EXISTS "changeSet" jsonb`,
    );

    // The pipeline acts on its own now: a `system` actor, and the shadow and
    // canary-decision actions.
    await queryRunner.query(
      `ALTER TABLE "agent_releases" DROP CONSTRAINT IF EXISTS "CHK_agent_releases_author_kind"`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_releases" ADD CONSTRAINT "CHK_agent_releases_author_kind" CHECK ("authorKind" IN (
        'seed', 'human', 'curator', 'system'
      ))`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_release_audit" DROP CONSTRAINT IF EXISTS "CHK_agent_release_audit_actor_kind"`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_release_audit" ADD CONSTRAINT "CHK_agent_release_audit_actor_kind" CHECK ("actorKind" IN (
        'seed', 'human', 'curator', 'system'
      ))`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_release_audit" DROP CONSTRAINT IF EXISTS "CHK_agent_release_audit_action"`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_release_audit" ADD CONSTRAINT "CHK_agent_release_audit_action" CHECK ("action" IN (
        'created', 'status_changed', 'promoted', 'rolled_back',
        'emergency_rollback', 'canary_started', 'canary_stopped',
        'shadow_started', 'shadow_completed', 'canary_decided', 'canary_reverted',
        'note'
      ))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "agent_release_audit" WHERE "action" IN ('shadow_started', 'shadow_completed', 'canary_decided', 'canary_reverted') OR "actorKind" = 'system'`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_release_audit" DROP CONSTRAINT IF EXISTS "CHK_agent_release_audit_action"`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_release_audit" ADD CONSTRAINT "CHK_agent_release_audit_action" CHECK ("action" IN (
        'created', 'status_changed', 'promoted', 'rolled_back',
        'emergency_rollback', 'canary_started', 'canary_stopped', 'note'
      ))`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_release_audit" DROP CONSTRAINT IF EXISTS "CHK_agent_release_audit_actor_kind"`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_release_audit" ADD CONSTRAINT "CHK_agent_release_audit_actor_kind" CHECK ("actorKind" IN (
        'seed', 'human', 'curator'
      ))`,
    );
    await queryRunner.query(
      `UPDATE "agent_releases" SET "authorKind" = 'curator' WHERE "authorKind" = 'system'`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_releases" DROP CONSTRAINT IF EXISTS "CHK_agent_releases_author_kind"`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_releases" ADD CONSTRAINT "CHK_agent_releases_author_kind" CHECK ("authorKind" IN (
        'seed', 'human', 'curator'
      ))`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_releases" DROP COLUMN IF EXISTS "changeSet"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "agent_synthetic_runs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "agent_shadow_reports"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "agent_delegation"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "agent_lesson_audit"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "agent_lessons"`);
  }
}
