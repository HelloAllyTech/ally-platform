import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The Prod Director's star on roadmap opportunities.
 *
 * - roadmap_rank_weights.prodDirectorUserId — which platform admin is the internal prod
 *   director. Lives on the weights singleton because it is a ranking-settings choice and the
 *   list query already reads that row on every board load. ON DELETE SET NULL: deleting the
 *   user leaves the board with no director rather than a dangling id.
 * - roadmap_rank_weights.starWeight — the fifth composite-rank factor (0-10, default 3). A
 *   starred opportunity scores 100 on it, an unstarred one 0.
 * - roadmap_opportunities.directorStarred — the star itself. Persists when the director
 *   changes: a star is a standing priority call on the opportunity, not on the person.
 *
 * The range and non-zero CHECKs are rebuilt to include the new weight.
 */
export class AddRoadmapProdDirectorStar1981901700000 implements MigrationInterface {
  name = 'AddRoadmapProdDirectorStar1981901700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "roadmap_rank_weights" ` +
        `ADD COLUMN "starWeight" integer NOT NULL DEFAULT 3, ` +
        `ADD COLUMN "prodDirectorUserId" integer NULL ` +
        `REFERENCES "users"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "roadmap_rank_weights" ` +
        `DROP CONSTRAINT "CHK_roadmap_rank_weights_range", ` +
        `DROP CONSTRAINT "CHK_roadmap_rank_weights_nonzero"`,
    );
    await queryRunner.query(
      `ALTER TABLE "roadmap_rank_weights" ` +
        `ADD CONSTRAINT "CHK_roadmap_rank_weights_range" CHECK (` +
        `"votesWeight" BETWEEN 0 AND 10 AND "votersWeight" BETWEEN 0 AND 10 AND ` +
        `"effortWeight" BETWEEN 0 AND 10 AND "goalImpactWeight" BETWEEN 0 AND 10 AND ` +
        `"starWeight" BETWEEN 0 AND 10), ` +
        `ADD CONSTRAINT "CHK_roadmap_rank_weights_nonzero" CHECK (` +
        `"votesWeight" + "votersWeight" + "effortWeight" + "goalImpactWeight" + "starWeight" > 0)`,
    );
    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunities" ` +
        `ADD COLUMN "directorStarred" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunities" DROP COLUMN "directorStarred"`,
    );
    await queryRunner.query(
      `ALTER TABLE "roadmap_rank_weights" ` +
        `DROP CONSTRAINT "CHK_roadmap_rank_weights_range", ` +
        `DROP CONSTRAINT "CHK_roadmap_rank_weights_nonzero"`,
    );
    await queryRunner.query(
      `ALTER TABLE "roadmap_rank_weights" ` +
        `DROP COLUMN "prodDirectorUserId", DROP COLUMN "starWeight"`,
    );
    await queryRunner.query(
      `ALTER TABLE "roadmap_rank_weights" ` +
        `ADD CONSTRAINT "CHK_roadmap_rank_weights_range" CHECK (` +
        `"votesWeight" BETWEEN 0 AND 10 AND "votersWeight" BETWEEN 0 AND 10 AND ` +
        `"effortWeight" BETWEEN 0 AND 10 AND "goalImpactWeight" BETWEEN 0 AND 10), ` +
        `ADD CONSTRAINT "CHK_roadmap_rank_weights_nonzero" CHECK (` +
        `"votesWeight" + "votersWeight" + "effortWeight" + "goalImpactWeight" > 0)`,
    );
  }
}
