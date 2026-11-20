import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The auto-release policy, in shadow mode (Roadmap v2, phase P5).
 *
 *  - `release_policy_log`: what the policy decided per service ("would
 *    release be-v… with these commits"), what humans actually released in the
 *    same window and how the two compare, Release clicks, and circuit-breaker
 *    events. The cutover check ("it would have released exactly what humans
 *    released") is read from this table.
 *  - `builder_settings`: the breaker's platform-wide pause
 *    (`autoReleasePausedAt`, `autoReleasePausedReason`) and
 *    `autoReleasePolicyLive`, which stays false: P5 only ever runs in shadow.
 *
 * Additive only. Nothing existing is altered, and no new column gates
 * existing behaviour, so there is nothing to backfill.
 */
export class CreateReleasePolicyLog1983500000000 implements MigrationInterface {
  name = 'CreateReleasePolicyLog1983500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "release_policy_log" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "kind" character varying(20) NOT NULL,
        "mode" character varying(8) NOT NULL,
        "service" character varying(12),
        "apps" character varying(10),
        "decision" character varying(20),
        "breakerEvent" character varying(12),
        "reason" text,
        "baseRef" character varying(80),
        "baseTag" character varying(80),
        "headSha" character varying(64),
        "serviceHeadSha" character varying(64),
        "tag" character varying(80),
        "commits" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "heldReasons" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "opportunityIds" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "runId" character varying(32),
        "runUrl" text,
        "startedAt" TIMESTAMP,
        "finishedAt" TIMESTAMP,
        "outcome" character varying(12),
        "healthy" boolean,
        "healthCheckedAt" TIMESTAMP,
        "healthAttempts" integer NOT NULL DEFAULT 0,
        "origin" character varying(12),
        "comparison" character varying(24),
        "comparedDecisionId" uuid,
        "userId" integer,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_release_policy_log" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_release_policy_log_kind" CHECK ("kind" IN ('decision', 'observed_release', 'manual_release', 'breaker')),
        CONSTRAINT "CHK_release_policy_log_mode" CHECK ("mode" IN ('shadow', 'live', 'manual')),
        CONSTRAINT "CHK_release_policy_log_service" CHECK ("service" IS NULL OR "service" IN ('be', 'ai', 'learn', 'frontend')),
        CONSTRAINT "CHK_release_policy_log_apps" CHECK ("apps" IS NULL OR "apps" IN ('admin', 'helpline', 'both')),
        CONSTRAINT "CHK_release_policy_log_decision" CHECK ("decision" IS NULL OR "decision" IN ('release', 'held', 'paused', 'debouncing', 'outside_window', 'waiting_backend', 'nothing', 'unknown')),
        CONSTRAINT "CHK_release_policy_log_breaker_event" CHECK ("breakerEvent" IS NULL OR "breakerEvent" IN ('tripped', 'would_trip', 'resumed')),
        CONSTRAINT "CHK_release_policy_log_outcome" CHECK ("outcome" IS NULL OR "outcome" IN ('succeeded', 'failed')),
        CONSTRAINT "CHK_release_policy_log_origin" CHECK ("origin" IS NULL OR "origin" IN ('human', 'manual_click', 'policy')),
        CONSTRAINT "CHK_release_policy_log_comparison" CHECK ("comparison" IS NULL OR "comparison" IN ('match', 'different_head', 'no_decision', 'policy_held', 'policy_paused', 'policy_debouncing', 'policy_outside_window', 'policy_waiting_backend', 'policy_nothing', 'policy_unknown'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_release_policy_log_kind_service_created" ON "release_policy_log" ("kind", "service", "createdAt")`,
    );
    // One row per observed release run, however many passes see it.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_release_policy_log_observed_run" ON "release_policy_log" ("runId") WHERE "kind" = 'observed_release'`,
    );

    await queryRunner.query(`
      ALTER TABLE "builder_settings"
        ADD COLUMN IF NOT EXISTS "autoReleasePolicyLive" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "autoReleasePausedAt" TIMESTAMP NULL,
        ADD COLUMN IF NOT EXISTS "autoReleasePausedReason" character varying(500) NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "builder_settings"
        DROP COLUMN IF EXISTS "autoReleasePausedReason",
        DROP COLUMN IF EXISTS "autoReleasePausedAt",
        DROP COLUMN IF EXISTS "autoReleasePolicyLive"
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "release_policy_log"`);
  }
}
