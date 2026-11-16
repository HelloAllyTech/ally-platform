import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agent logs say where each entry came from (2026-11-16, with the
 * orchestrator on by default): `fixed` (steps the code always runs, and the
 * independent check), `planned` (an agent the planner chose for this session,
 * with its reason in `plan_reason`) or `top_up` (the evidence top-up after a
 * failed evaluation). Entries stored before carry NULL: shown as unknown,
 * never as fixed.
 *
 * Hand-written SQL, never `migration:generate`.
 */
export class AddDebriefRunLogOrigin1981901400000 implements MigrationInterface {
  name = 'AddDebriefRunLogOrigin1981901400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "debrief_run_logs"
        ADD COLUMN IF NOT EXISTS "origin" varchar(8) NULL,
        ADD COLUMN IF NOT EXISTS "plan_reason" text NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "debrief_run_logs"
        DROP COLUMN IF EXISTS "plan_reason",
        DROP COLUMN IF EXISTS "origin"
    `);
  }
}
