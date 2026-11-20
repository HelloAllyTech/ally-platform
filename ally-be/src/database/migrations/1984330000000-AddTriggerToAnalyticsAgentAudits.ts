import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Records what started an Analytics Agent audit run: `manual` (someone pressed
 * Start in the Audit agent tab) or `scheduled` (the shared scheduler did).
 *
 * Existing rows were all started by hand — the scheduled trigger did not exist
 * when they were saved — so the default is `manual`. Plain varchar, no CHECK, so
 * a new trigger never needs a migration. Additive and idempotent.
 */
export class AddTriggerToAnalyticsAgentAudits1984330000000 implements MigrationInterface {
  name = 'AddTriggerToAnalyticsAgentAudits1984330000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "analytics_agent_audits"
        ADD COLUMN IF NOT EXISTS "trigger" character varying(16) NOT NULL DEFAULT 'manual'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "analytics_agent_audits" DROP COLUMN IF EXISTS "trigger"`,
    );
  }
}
