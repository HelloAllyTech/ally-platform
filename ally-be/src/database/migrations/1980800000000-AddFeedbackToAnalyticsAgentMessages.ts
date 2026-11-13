import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A reader's thumbs up / thumbs down on one Analytics Agent answer.
 *
 * Nullable with no default: feedback is optional, and NULL means the reader said
 * nothing — which is every existing row. Plain varchar, no CHECK, so another
 * rating never needs a migration. Additive and idempotent.
 */
export class AddFeedbackToAnalyticsAgentMessages1980800000000 implements MigrationInterface {
  name = 'AddFeedbackToAnalyticsAgentMessages1980800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "analytics_agent_messages"
        ADD COLUMN IF NOT EXISTS "feedback" character varying(8)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "analytics_agent_messages" DROP COLUMN IF EXISTS "feedback"`,
    );
  }
}
