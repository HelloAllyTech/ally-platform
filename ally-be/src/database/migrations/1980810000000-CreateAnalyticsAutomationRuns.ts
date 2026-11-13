import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Analytics Automation: the weekly run of three agents (backend review,
 * PostHog events, dbt changes).
 *
 * - `analytics_automation_runs` — one row per weekly run: when it started and
 *   the commit SHAs every agent saw. A partial unique index allows one
 *   `running` row at a time (TypeORM cannot declare it).
 * - `analytics_automation_agent_runs` — one row per agent per run (unique on
 *   run + agent): status, markdown summary, the pull request it opened and the
 *   review verdict on it, and the approve/reject decision.
 * - `analytics_automation_findings` — the items an agent found.
 *
 * Additive only; status columns are plain varchar with no CHECK.
 */
export class CreateAnalyticsAutomationRuns1980810000000 implements MigrationInterface {
  name = 'CreateAnalyticsAutomationRuns1980810000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "analytics_automation_runs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "ranAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "finishedAt" TIMESTAMP WITH TIME ZONE,
        "status" character varying(16) NOT NULL DEFAULT 'running',
        "trigger" character varying(16) NOT NULL DEFAULT 'scheduled',
        "commitShas" jsonb NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_analytics_automation_runs_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_analytics_automation_runs_ran_at"
        ON "analytics_automation_runs" ("ranAt")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_analytics_automation_runs_one_running"
        ON "analytics_automation_runs" ((true)) WHERE "status" = 'running'`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "analytics_automation_agent_runs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "runId" uuid NOT NULL,
        "agent" character varying(32) NOT NULL,
        "status" character varying(24) NOT NULL,
        "startedAt" TIMESTAMP WITH TIME ZONE,
        "finishedAt" TIMESTAMP WITH TIME ZONE,
        "summary" text,
        "output" jsonb NOT NULL DEFAULT '{}',
        "note" text,
        "prRepo" character varying(128),
        "prNumber" integer,
        "prUrl" text,
        "prState" character varying(16),
        "reviewVerdict" character varying(16),
        "reviewSummary" text,
        "decision" character varying(16),
        "decidedBy" integer,
        "decidedAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_analytics_automation_agent_runs_id" PRIMARY KEY ("id"),
        CONSTRAINT "uq_analytics_automation_agent_runs_run_agent" UNIQUE ("runId", "agent"),
        CONSTRAINT "FK_analytics_automation_agent_runs_run"
          FOREIGN KEY ("runId") REFERENCES "analytics_automation_runs"("id") ON DELETE CASCADE
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_analytics_automation_agent_runs_pr_state"
        ON "analytics_automation_agent_runs" ("prState")`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "analytics_automation_findings" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "agentRunId" uuid NOT NULL,
        "kind" character varying(32) NOT NULL,
        "title" character varying(200) NOT NULL,
        "detail" text,
        "payload" jsonb NOT NULL DEFAULT '{}',
        "fingerprint" character varying(64) NOT NULL,
        "status" character varying(16) NOT NULL DEFAULT 'proposed',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_analytics_automation_findings_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_analytics_automation_findings_agent_run"
          FOREIGN KEY ("agentRunId") REFERENCES "analytics_automation_agent_runs"("id") ON DELETE CASCADE
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_analytics_automation_findings_agent_run"
        ON "analytics_automation_findings" ("agentRunId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_analytics_automation_findings_fingerprint"
        ON "analytics_automation_findings" ("fingerprint")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "analytics_automation_findings"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "analytics_automation_agent_runs"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "uq_analytics_automation_runs_one_running"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "analytics_automation_runs"`);
  }
}
