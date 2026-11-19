import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Every roadmap idea now carries a required title, stored as the first line of `description`
 * (title, blank line, summary). The summary keeps its 1000-character limit and the title gets
 * its own 200, so the column must hold both: 200 + 2 + 1000.
 */
export class RaiseRoadmapDescriptionLimitForTitle1984900000000 implements MigrationInterface {
  name = 'RaiseRoadmapDescriptionLimitForTitle1984900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunities" DROP CONSTRAINT "CHK_roadmap_opps_description"`,
    );
    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunities" ADD CONSTRAINT "CHK_roadmap_opps_description" CHECK (char_length(trim("description")) > 0 AND char_length("description") <= 1202)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunities" DROP CONSTRAINT "CHK_roadmap_opps_description"`,
    );
    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunities" ADD CONSTRAINT "CHK_roadmap_opps_description" CHECK (char_length(trim("description")) > 0 AND char_length("description") <= 1000)`,
    );
  }
}
