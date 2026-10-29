import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The Builder tab's two settings-and-plumbing columns.
 *
 * - `builder_settings.inProgressLimit` (default 3): how many sessions a person wants in progress
 *   at once. Up next refuses Start at the limit and offers Put back; it never queues silently.
 *   Separate from `maxConcurrentBuilds`, which is the runner budget.
 * - `builder_pull_requests.slackChannel` / `slackMessageTs`: where the merge prompt was posted,
 *   so the message can be edited to "Answered in Ally" once the pull request merges from any
 *   surface, instead of leaving a live button on finished work.
 */
export class AddBuilderRoomColumns1980780000000 implements MigrationInterface {
  name = 'AddBuilderRoomColumns1980780000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "builder_settings" ADD COLUMN IF NOT EXISTS "inProgressLimit" integer NOT NULL DEFAULT 3`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_pull_requests" ADD COLUMN IF NOT EXISTS "slackChannel" character varying(40)`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_pull_requests" ADD COLUMN IF NOT EXISTS "slackMessageTs" character varying(40)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "builder_pull_requests" DROP COLUMN IF EXISTS "slackMessageTs"`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_pull_requests" DROP COLUMN IF EXISTS "slackChannel"`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_settings" DROP COLUMN IF EXISTS "inProgressLimit"`,
    );
  }
}
