import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Roadmap v2 P6, the cutover (plans/roadmap-builder-merge §6, §7). Schema
 * only: nothing here moves data or flips `roadmapV2Enabled`. The move is an
 * action the Owner runs (`POST /v1/roadmap/cutover`), so production does not
 * change on deploy.
 *
 * 1. `roadmap_idea_drafts.migratedAt` / `migratedToId`: the cutover copies a
 *    parked draft into a private plan draft and labels the source row instead
 *    of deleting it, so turning Roadmap off shows the old drafts unchanged and
 *    a second run skips them. `migratedToId` is the plan session (no FK: the
 *    draft outlives an expiry purge of the session).
 * 2. `roadmap_opportunities.source` gains `migrated_builder_session`: the idea
 *    filed for an in-flight direct Builder session. Every existing value kept.
 * 3. `roadmap_cutover_log`: who ran the cutover, when, the counts, and the
 *    Builder and Owner ids they confirmed. Append-only.
 */
export class AddRoadmapCutover1983700000000 implements MigrationInterface {
  name = 'AddRoadmapCutover1983700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "roadmap_idea_drafts"
        ADD COLUMN IF NOT EXISTS "migratedAt" timestamptz NULL,
        ADD COLUMN IF NOT EXISTS "migratedToId" uuid NULL
    `);

    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunities" DROP CONSTRAINT IF EXISTS "CHK_roadmap_opps_source"`,
    );
    // Written out in full: check-constraints-cover-enums.spec reads the literal list.
    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunities" ADD CONSTRAINT "CHK_roadmap_opps_source" CHECK ("source" IN ('staff', 'consumer', 'pm_agent', 'migrated_builder_session'))`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "roadmap_cutover_log" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "actorUserId" integer NULL,
        "counts" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "confirmedBuilderIds" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "confirmedOwnerIds" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "flagWasOn" boolean NOT NULL DEFAULT false,
        "at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_roadmap_cutover_log" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_roadmap_cutover_log_at" ON "roadmap_cutover_log" ("at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_roadmap_cutover_log_at"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "roadmap_cutover_log"`);
    // The narrower CHECK cannot hold a migrated idea; it keeps its row as a staff filing.
    await queryRunner.query(
      `UPDATE "roadmap_opportunities" SET "source" = 'staff' WHERE "source" = 'migrated_builder_session'`,
    );
    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunities" DROP CONSTRAINT IF EXISTS "CHK_roadmap_opps_source"`,
    );
    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunities" ADD CONSTRAINT "CHK_roadmap_opps_source" CHECK ("source" IN ('staff', 'consumer', 'pm_agent'))`,
    );
    await queryRunner.query(`
      ALTER TABLE "roadmap_idea_drafts"
        DROP COLUMN IF EXISTS "migratedToId",
        DROP COLUMN IF EXISTS "migratedAt"
    `);
  }
}
