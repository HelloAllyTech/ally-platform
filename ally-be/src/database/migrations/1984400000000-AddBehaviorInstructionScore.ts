import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-behaviour score (2026-11-18). Until now every behaviour instruction was worth a hardcoded
 * +10 (SHOULD_DO) or -10 (SHOULD_NOT_DO). Authors can now set an integer in [-100, 100] per row.
 *
 * Both columns are NULLABLE with no backfill: NULL means "the category default", so every existing
 * roleplay and every past session scores and analyses exactly as before.
 *  - scenario_behavior_instructions.score: the authored value.
 *  - scenario_session_behavior_instructions.score: the value applied at detection, frozen so a later
 *    edit cannot re-score past sessions.
 */
export class AddBehaviorInstructionScore1984400000000 implements MigrationInterface {
  name = 'AddBehaviorInstructionScore1984400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_behavior_instructions" ADD COLUMN IF NOT EXISTS "score" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenario_session_behavior_instructions" ADD COLUMN IF NOT EXISTS "score" integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scenario_session_behavior_instructions" DROP COLUMN IF EXISTS "score"`,
    );
    await queryRunner.query(
      `ALTER TABLE "scenario_behavior_instructions" DROP COLUMN IF EXISTS "score"`,
    );
  }
}
