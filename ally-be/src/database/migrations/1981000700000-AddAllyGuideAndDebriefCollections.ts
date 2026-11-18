import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Context Library, phase 6 (docs/context-library/PLAN.md §11): the two collections the Ally guide
 * and Debrief read instead of the Knowledge Base's `ally_guide_library` and `debrief_knowledge`
 * corpora — **Ally Guide Library** (`ally_guide_library`, `AG-`) and **Debrief Guidance**
 * (`debrief_guidance`, `DG-`).
 *
 * A collection is its profile (`src/context-library/profiles/ally-guide-library.profile.ts`,
 * `debrief-guidance.profile.ts`) plus its row here. Grants are written explicitly, so Settings
 * shows real rows from the start: `ally_guide` → Ally Guide Library, `debrief` → Debrief
 * Guidance. Neither is ever granted to engineers' `mcp_dev` — that lock is in code
 * (`neverGrantTo`) — and `admin_preview` and `eval` read every collection by default.
 *
 * Nothing here touches the old corpora. The next migration copies their passages in, and their
 * documents, files and Weaviate collections are deleted only by a separate, confirmed
 * platform-admin action (§6.5), never by a migration.
 */
const COLLECTIONS: Array<[string, string, string]> = [
  ['ally_guide_library', 'Ally Guide Library', 'AG'],
  ['debrief_guidance', 'Debrief Guidance', 'DG'],
];

const GRANTS: Array<[string, string]> = [
  ['ally_guide', 'ally_guide_library'],
  ['debrief', 'debrief_guidance'],
];

export class AddAllyGuideAndDebriefCollections1981000700000 implements MigrationInterface {
  name = 'AddAllyGuideAndDebriefCollections1981000700000';

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
      // Only while empty: a rollback must never take entries or guidelines with it.
      await queryRunner.query(
        `DELETE FROM "cl_collections" WHERE "id" = $1
           AND NOT EXISTS (SELECT 1 FROM "cl_chunks" WHERE "collection_id" = $1)`,
        [id],
      );
    }
  }
}
