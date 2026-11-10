import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Context Library, phase 4 (docs/context-library/PLAN.md §11): the Character Insights
 * collection, which the character interview's `search_corpus` tool reads instead of the
 * Knowledge Base's character corpus.
 *
 * A collection is its profile (`src/context-library/profiles/character-insights.profile.ts`)
 * plus this row. The grant for `character_interview` is written explicitly rather than left to
 * the use case's code default, so Settings shows a real row from the start. No other use case
 * gets a row: `mcp_dev` is locked out in code (`neverGrantTo`), and `admin_preview` and `eval`
 * read every collection by default.
 *
 * Nothing here touches the old corpus. Its documents are distilled into this collection by the
 * admin-triggered import job, and deleted only by a separate, confirmed platform-admin action
 * (§6.5) — never by a migration.
 */
export class AddCharacterInsightsCollection1981000300000 implements MigrationInterface {
  name = 'AddCharacterInsightsCollection1981000300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "cl_collections" ("id", "name", "code_prefix") VALUES ('character_insights', 'Character Insights', 'CI')
       ON CONFLICT ("id") DO NOTHING`,
    );
    await queryRunner.query(
      `INSERT INTO "cl_use_case_access" ("use_case", "collection_id", "enabled", "weight")
       VALUES ('character_interview', 'character_insights', true, 1)
       ON CONFLICT ("use_case", "collection_id") DO NOTHING`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "cl_use_case_access" WHERE "collection_id" = 'character_insights'`,
    );
    // Only while it is empty: chunks reference the collection, and a rollback must never take
    // distilled insights with it.
    await queryRunner.query(
      `DELETE FROM "cl_collections" WHERE "id" = 'character_insights'
         AND NOT EXISTS (SELECT 1 FROM "cl_chunks" WHERE "collection_id" = 'character_insights')`,
    );
  }
}
