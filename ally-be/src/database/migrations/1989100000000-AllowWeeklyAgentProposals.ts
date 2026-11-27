import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The Product Manual's weekly agent no longer edits pages on its own (its live edits lost or
 * changed true claims in every production run). It now verifies pages and, when code it read
 * contradicts a specific sentence, files that finding as a proposal with source `weekly_agent`.
 * `manual_proposals.source` only allowed `coding_agent` and `chat`, so widen the CHECK.
 */
export class AllowWeeklyAgentProposals1989100000000 implements MigrationInterface {
  name = 'AllowWeeklyAgentProposals1989100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "manual_proposals" DROP CONSTRAINT "CHK_manual_proposals_source"`,
    );
    await queryRunner.query(
      `ALTER TABLE "manual_proposals" ADD CONSTRAINT "CHK_manual_proposals_source" CHECK ("source" IN ('coding_agent', 'chat', 'weekly_agent'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Rows filed by the weekly agent would violate the narrower CHECK, so they go first.
    await queryRunner.query(
      `DELETE FROM "manual_proposals" WHERE "source" = 'weekly_agent'`,
    );
    await queryRunner.query(
      `ALTER TABLE "manual_proposals" DROP CONSTRAINT "CHK_manual_proposals_source"`,
    );
    await queryRunner.query(
      `ALTER TABLE "manual_proposals" ADD CONSTRAINT "CHK_manual_proposals_source" CHECK ("source" IN ('coding_agent', 'chat'))`,
    );
  }
}
