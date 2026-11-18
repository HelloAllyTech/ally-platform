import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Run state for Analytics Agent audits, so a run can be started from the UI and
 * watched rather than awaited in one HTTP request.
 *
 *  - `status` — running | completed | failed. Rows that already exist were saved
 *    by the earlier all-at-once version, so they are `completed`.
 *  - `totalMessages` — how many messages the run set out to audit; backfilled
 *    from what each existing row holds.
 *  - A partial unique index allowing at most ONE `running` row. A second start
 *    while one is in flight fails on insert, which is what stops two runs
 *    auditing the same message (the "already audited" check only sees finished
 *    entries).
 *
 * Additive only; every statement is idempotent. No CHECK constraints.
 */
export class AddRunStateToAnalyticsAgentAudits1984120000000 implements MigrationInterface {
  name = 'AddRunStateToAnalyticsAgentAudits1984120000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "analytics_agent_audits"
        ADD COLUMN IF NOT EXISTS "status" character varying(16) NOT NULL DEFAULT 'completed'`,
    );
    await queryRunner.query(
      `ALTER TABLE "analytics_agent_audits"
        ADD COLUMN IF NOT EXISTS "totalMessages" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `UPDATE "analytics_agent_audits"
          SET "totalMessages" = jsonb_array_length("messages")
        WHERE "totalMessages" = 0`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_analytics_agent_audits_one_running"
        ON "analytics_agent_audits" ((true)) WHERE "status" = 'running'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "uq_analytics_agent_audits_one_running"`,
    );
    await queryRunner.query(
      `ALTER TABLE "analytics_agent_audits" DROP COLUMN IF EXISTS "totalMessages"`,
    );
    await queryRunner.query(
      `ALTER TABLE "analytics_agent_audits" DROP COLUMN IF EXISTS "status"`,
    );
  }
}
