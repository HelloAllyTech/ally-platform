import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The Product Manual's weekly agent now keeps a one-line outcome per work item on its run row
 * (`item_log`): which item, what came of it (applied / edited / checked / not finished), how the
 * model loop ended and how many steps and dollars it took. The first production run looked at 25
 * items, spent $0.16 and verified none; the row held only the totals, so the reason could not be
 * read back. A page's text never goes in this column.
 */
export class AddManualRunItemLog1988700000000 implements MigrationInterface {
  name = 'AddManualRunItemLog1988700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "manual_runs" ADD COLUMN "item_log" jsonb NOT NULL DEFAULT '[]'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "manual_runs" DROP COLUMN "item_log"`);
  }
}
