import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Analytics Agent audit runs.
 *
 * `analytics_agent_audits` — one row per run of the audit agent: when it ran
 * (`ranAt`) and, in `messages` (jsonb), each audited message as
 * `{ messageId, askedAt, question, answer, audit, error? }`.
 *
 * No FK to `analytics_agent_messages`: an entry is a snapshot of the answer as
 * it was audited, and must outlive the conversation it came from. Additive
 * only; no CHECK constraints.
 */
export class CreateAnalyticsAgentAudits1984310000000 implements MigrationInterface {
  name = 'CreateAnalyticsAgentAudits1984310000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "analytics_agent_audits" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "ranAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "messages" jsonb NOT NULL DEFAULT '[]',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_analytics_agent_audits_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_analytics_agent_audits_ran_at"
        ON "analytics_agent_audits" ("ranAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_analytics_agent_audits_ran_at"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "analytics_agent_audits"`);
  }
}
