import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Roadmap v2's per-person preferences (plans/roadmap-builder-merge §5.7b):
 * today only the weekly "Your ideas this week" digest, off by default. A
 * missing row means every default, so nothing needs a backfill. Additive;
 * only the roadmap_v2 routes write it.
 */
export class CreateRoadmapUserPreferences1983400000100 implements MigrationInterface {
  name = 'CreateRoadmapUserPreferences1983400000100';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "roadmap_user_preferences" (
        "userId" integer NOT NULL,
        "weeklyDigest" boolean NOT NULL DEFAULT false,
        "lastDigestAt" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_roadmap_user_preferences" PRIMARY KEY ("userId"),
        CONSTRAINT "FK_roadmap_user_preferences_user" FOREIGN KEY ("userId")
          REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "roadmap_user_preferences"`);
  }
}
