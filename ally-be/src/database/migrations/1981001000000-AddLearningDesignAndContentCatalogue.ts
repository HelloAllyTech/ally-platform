import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Context Library, phase 7 (docs/context-library/PLAN.md §11): the two collections Course Copilot
 * reads instead of the third-party guidance library and its own `ILike` catalogue search —
 * **Learning Design** (`learning_design`, `LD-`, noun "principle"; distilled and written) and the
 * **Content Catalogue** (`content_catalogue`, `CC-`, noun "item"; synced from Studio only).
 *
 * A collection is its profile (`src/context-library/profiles/learning-design.profile.ts`,
 * `content-catalogue.profile.ts`) plus its row here. Grants are written explicitly, per PLAN
 * §2.2, so Settings shows real rows from the start:
 *  - Learning Design → `course_copilot` and engineers' `mcp_dev`;
 *  - Content Catalogue → `course_copilot` only.
 * Every other agent is locked out of both in code (`neverGrantTo`), `mcp_dev` included for the
 * catalogue (organisations' own content never reaches engineers' editors); `admin_preview` and
 * `eval` read every collection by default and get no row.
 *
 * No chunk is written here. The catalogue is filled by its reconciliation
 * (`ContextCatalogueSyncService`), which runs once shortly after boot while the collection is
 * empty and nightly after that; it needs the profile's code to build each chunk, which a
 * migration must not import.
 */
const COLLECTIONS: Array<[string, string, string]> = [
  ['learning_design', 'Learning Design', 'LD'],
  ['content_catalogue', 'Content Catalogue', 'CC'],
];

const GRANTS: Array<[string, string]> = [
  ['course_copilot', 'learning_design'],
  ['mcp_dev', 'learning_design'],
  ['course_copilot', 'content_catalogue'],
];

export class AddLearningDesignAndContentCatalogue1981001000000 implements MigrationInterface {
  name = 'AddLearningDesignAndContentCatalogue1981001000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [id, name, prefix] of COLLECTIONS) {
      await queryRunner.query(
        `INSERT INTO "cl_collections" ("id", "name", "code_prefix") VALUES ($1, $2, $3)
         ON CONFLICT ("id") DO NOTHING`,
        [id, name, prefix],
      );
    }
    for (const [useCase, collectionId] of GRANTS) {
      await queryRunner.query(
        `INSERT INTO "cl_use_case_access" ("use_case", "collection_id", "enabled", "weight")
         VALUES ($1, $2, true, 1)
         ON CONFLICT ("use_case", "collection_id") DO NOTHING`,
        [useCase, collectionId],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [id] of COLLECTIONS) {
      await queryRunner.query(
        `DELETE FROM "cl_use_case_access" WHERE "collection_id" = $1`,
        [id],
      );
      // Only while empty: a rollback must never take principles or synced items with it. (The
      // catalogue's items can be rebuilt from Studio, but their learned searches cannot.)
      await queryRunner.query(
        `DELETE FROM "cl_collections" WHERE "id" = $1
           AND NOT EXISTS (SELECT 1 FROM "cl_chunks" WHERE "collection_id" = $1)`,
        [id],
      );
    }
  }
}
