import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Breadth weighting for roadmap votes.
 *
 * `votes` stays what the voter SPENT (the grant ledger and its balance trigger are untouched).
 * `weightedVotes` is what the vote is WORTH to the opportunity's priority score: votes
 * multiplied by the voter's breadth multiplier at the time each vote was cast. The score now
 * sums this column.
 *
 * `lastIncreasedAt` is when the row's vote count last went UP. The breadth multiplier counts
 * distinct colleagues backed inside a rolling window, and allocations are overwritten by an
 * absolute total, so per-vote history does not exist — this is the one timestamp that
 * survives. Decreases deliberately do not touch it.
 *
 * Backfill is multiplier 1.0 (weightedVotes = votes), so no existing score moves at launch.
 */
export class AddRoadmapVoteWeighting1980930000000 implements MigrationInterface {
  name = 'AddRoadmapVoteWeighting1980930000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "roadmap_allocations"
        ADD COLUMN IF NOT EXISTS "weightedVotes" numeric(10,3) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "lastIncreasedAt" timestamptz NULL
    `);
    await queryRunner.query(`
      UPDATE "roadmap_allocations"
         SET "weightedVotes" = "votes",
             "lastIncreasedAt" = "updatedAt"
       WHERE "weightedVotes" = 0 AND "votes" > 0
    `);
    await queryRunner.query(`
      ALTER TABLE "roadmap_allocations"
        ADD CONSTRAINT "CHK_roadmap_allocations_weighted_votes"
        CHECK ("weightedVotes" >= 0)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_roadmap_allocations_user_increased"
        ON "roadmap_allocations" ("userId", "lastIncreasedAt")
        WHERE "votes" > 0
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_roadmap_allocations_user_increased"`,
    );
    await queryRunner.query(`
      ALTER TABLE "roadmap_allocations"
        DROP CONSTRAINT IF EXISTS "CHK_roadmap_allocations_weighted_votes",
        DROP COLUMN IF EXISTS "lastIncreasedAt",
        DROP COLUMN IF EXISTS "weightedVotes"
    `);
  }
}
