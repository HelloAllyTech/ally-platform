import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The Product Manual's weekly agent now remembers when it last tried a page (`last_attempt_at`).
 * A page it could not finish was never marked, so it stayed at the front of the queue and every
 * run retried the same ones while the rest waited: in the third production run 18 of 25 pages ran
 * out of lookups and would have come first again. A page tried within the last 14 days now goes
 * behind the pages not tried recently. Nothing else reads this column.
 */
export class AddManualPageLastAttempt1988900000000 implements MigrationInterface {
  name = 'AddManualPageLastAttempt1988900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "manual_pages" ADD COLUMN "last_attempt_at" timestamptz`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "manual_pages" DROP COLUMN "last_attempt_at"`,
    );
  }
}
