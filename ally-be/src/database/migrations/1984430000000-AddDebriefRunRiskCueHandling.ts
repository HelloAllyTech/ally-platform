import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * How a run treated risk cues (`alarm` or `assessed`) was only a key inside
 * `workspace.riskCueOption`. It becomes a checked column, written when the run starts. Additive:
 * null means a run from before it, and every reader falls back to the workspace snapshot, so an
 * older ally-be running during a deploy still works. The backfill fills only empty values.
 */
export class AddDebriefRunRiskCueHandling1984430000000 implements MigrationInterface {
  name = 'AddDebriefRunRiskCueHandling1984430000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "debrief_runs" ADD COLUMN IF NOT EXISTS "riskCueHandling" character varying(10)`,
    );
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CHK_debrief_runs_risk_cue_handling') THEN
          ALTER TABLE "debrief_runs" ADD CONSTRAINT "CHK_debrief_runs_risk_cue_handling"
            CHECK ("riskCueHandling" IS NULL OR "riskCueHandling" IN ('alarm', 'assessed'));
        END IF;
      END $$
    `);
    await queryRunner.query(`
      UPDATE "debrief_runs"
         SET "riskCueHandling" = workspace->'riskCueOption'->>'handling'
       WHERE "riskCueHandling" IS NULL
         AND workspace->'riskCueOption'->>'handling' IN ('alarm', 'assessed')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "debrief_runs" DROP CONSTRAINT IF EXISTS "CHK_debrief_runs_risk_cue_handling"`,
    );
    await queryRunner.query(
      `ALTER TABLE "debrief_runs" DROP COLUMN IF EXISTS "riskCueHandling"`,
    );
  }
}
