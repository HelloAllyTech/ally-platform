import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The XP ladder now starts at level 0, but `user_progress.level` was created with
 * `CHECK ("level" >= 1)`. Without this, `ExtendXpLadderToFiftyLevels` fails on the first
 * learner under 100 XP, so this runs just before it.
 */
export class RelaxUserProgressLevelCheck1980829000000 implements MigrationInterface {
  name = 'RelaxUserProgressLevelCheck1980829000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_progress" DROP CONSTRAINT IF EXISTS "CHK_user_progress_level_min"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_progress" ADD CONSTRAINT "CHK_user_progress_level_min" CHECK ("level" >= 0)`,
    );
  }

  // Runs after `ExtendXpLadderToFiftyLevels.down` has moved every level back to >= 1.
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_progress" DROP CONSTRAINT IF EXISTS "CHK_user_progress_level_min"`,
    );
    await queryRunner.query(
      `ALTER TABLE "user_progress" ADD CONSTRAINT "CHK_user_progress_level_min" CHECK ("level" >= 1)`,
    );
  }
}
