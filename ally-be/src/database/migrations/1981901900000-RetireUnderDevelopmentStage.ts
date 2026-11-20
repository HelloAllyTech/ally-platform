import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Retires the `under_development` stage (admin-UX stage reduction, release 2 of 2).
 *
 * The roadmap lifecycle is Idea (`new`) → Prioritised → Released, with Archived a hidden
 * stored state. Release 1 stopped writing `under_development` and normalised client input;
 * this release folds the remaining rows into `prioritised` and tightens the CHECKs.
 *
 * up():
 *  1. Snapshots every affected id into `stage_retirement_snapshot` (kept after the migration,
 *     so the folded rows stay identifiable) and logs the count.
 *  2. UPDATEs `roadmap_opportunities.stage` and `bug_findings.stage_override` from
 *     `under_development` to `prioritised`. Soft-deleted rows are included — the CHECK
 *     applies to them too.
 *  3. Drops and recreates `CHK_roadmap_opps_stage` (migration 1871000000000) and
 *     `CHK_bug_findings_stage_override` (migration 1936000000000) without the value.
 *
 * down() restores the two old CHECKs only. The data CANNOT be un-folded: after up() a row that
 * was folded is indistinguishable from one that was prioritised by hand and then edited since,
 * so guessing would corrupt more than it repaired. If a true restore is ever needed, read the
 * ids from `stage_retirement_snapshot` and re-apply deliberately.
 *
 * Ship release 1 first and wait for it to be live — an old container still writing
 * `under_development` would hit the new CHECK. Hand-written SQL, no exported helpers.
 */
export class RetireUnderDevelopmentStage1981901900000 implements MigrationInterface {
  name = 'RetireUnderDevelopmentStage1981901900000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "stage_retirement_snapshot" (
        "source_table" varchar(64) NOT NULL,
        "row_id" uuid NOT NULL,
        "previous_stage" varchar(32) NOT NULL,
        "migrated_at" timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY ("source_table", "row_id")
      )
    `);
    await queryRunner.query(`
      INSERT INTO "stage_retirement_snapshot" ("source_table", "row_id", "previous_stage")
      SELECT 'roadmap_opportunities', "id", "stage"
        FROM "roadmap_opportunities" WHERE "stage" = 'under_development'
      UNION ALL
      SELECT 'bug_findings', "id", "stage_override"
        FROM "bug_findings" WHERE "stage_override" = 'under_development'
      ON CONFLICT DO NOTHING
    `);
    const [{ n }] = await queryRunner.query(
      `SELECT count(*)::int AS n FROM "stage_retirement_snapshot"`,
    );
    console.log(
      `[RetireUnderDevelopmentStage] snapshotted ${n} row(s) into stage_retirement_snapshot`,
    );

    await queryRunner.query(
      `UPDATE "roadmap_opportunities" SET "stage" = 'prioritised' WHERE "stage" = 'under_development'`,
    );
    await queryRunner.query(
      `UPDATE "bug_findings" SET "stage_override" = 'prioritised' WHERE "stage_override" = 'under_development'`,
    );

    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunities" DROP CONSTRAINT "CHK_roadmap_opps_stage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunities" ADD CONSTRAINT "CHK_roadmap_opps_stage"
         CHECK ("stage" IN ('new', 'prioritised', 'released', 'archived'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "bug_findings" DROP CONSTRAINT "CHK_bug_findings_stage_override"`,
    );
    await queryRunner.query(
      `ALTER TABLE "bug_findings" ADD CONSTRAINT "CHK_bug_findings_stage_override"
         CHECK ("stage_override" IS NULL OR "stage_override" IN ('new', 'prioritised', 'released', 'archived'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunities" DROP CONSTRAINT "CHK_roadmap_opps_stage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunities" ADD CONSTRAINT "CHK_roadmap_opps_stage"
         CHECK ("stage" IN ('new', 'prioritised', 'under_development', 'released', 'archived'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "bug_findings" DROP CONSTRAINT "CHK_bug_findings_stage_override"`,
    );
    await queryRunner.query(
      `ALTER TABLE "bug_findings" ADD CONSTRAINT "CHK_bug_findings_stage_override"
         CHECK ("stage_override" IS NULL OR "stage_override" IN ('new', 'prioritised', 'under_development', 'released', 'archived'))`,
    );
  }
}
