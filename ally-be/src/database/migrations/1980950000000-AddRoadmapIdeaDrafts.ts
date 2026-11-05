import { MigrationInterface, QueryRunner } from 'typeorm';

/** Private, unpublished raw ideas captured by voice or typing, before the guided interview. */
export class AddRoadmapIdeaDrafts1980950000000 implements MigrationInterface {
  name = 'AddRoadmapIdeaDrafts1980950000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "roadmap_idea_drafts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "ownerUserId" integer NOT NULL,
        "rawText" text NOT NULL,
        "captureMode" character varying(10) NOT NULL DEFAULT 'typed',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP,
        CONSTRAINT "PK_roadmap_idea_drafts" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_roadmap_idea_drafts_owner"
        ON "roadmap_idea_drafts" ("ownerUserId", "updatedAt")
        WHERE "deletedAt" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_roadmap_idea_drafts_owner"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "roadmap_idea_drafts"`);
  }
}
