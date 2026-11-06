import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drop the pre-Skills-Store snapshot tables that
 * `1980150000000-SnapshotPromptsBeforeSkillsStore` created.
 *
 * IRREVERSIBLE: this permanently deletes the database's own copies of the
 * prompt tables as they were before the 2026-10-26 cutover (the 26 removed
 * prompts, each row's pre-move `defaultPrompt`, the old override flags). They
 * existed only to support a rollback, and that window has closed. The manual
 * RDS snapshot taken before the cutover is separate and is not touched here.
 *
 * `down` cannot restore the data. It does nothing: recreating empty tables
 * would only pretend the copies were back.
 */
const SNAPSHOT_TABLES = [
  'prompts_snapshot_pre_skills_store',
  'prompts_versions_snapshot_pre_skills_store',
  'prompt_translations_snapshot_pre_skills_store',
];

export class DropPreSkillsStoreSnapshots1980850000000 implements MigrationInterface {
  name = 'DropPreSkillsStoreSnapshots1980850000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of SNAPSHOT_TABLES) {
      await queryRunner.query(`DROP TABLE IF EXISTS "${table}"`);
    }
  }

  public async down(): Promise<void> {
    // The dropped rows are gone; there is nothing to put back.
  }
}
