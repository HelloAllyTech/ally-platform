import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Context Library, phase 5 (docs/context-library/PLAN.md §11): the two collections agents write
 * to — **Builder Lessons** (`builder_lessons`, `BL-`) and **Bug Hunter Notes**
 * (`bug_hunter_notes`, `BN-`) — their default grants, and the agent curator's loop actions.
 *
 * A collection is its profile (`src/context-library/profiles/builder-lessons.profile.ts`,
 * `bug-hunter-notes.profile.ts`) plus its row here. Grants are written explicitly, per PLAN
 * §2.2/§2.3, so Settings shows real rows from the start:
 *  - Builder Lessons → every `builder_*` use case, `builder_build`, and engineers' `mcp_dev`;
 *  - Bug Hunter Notes → `bug_hunter` and `mcp_dev`.
 * `admin_preview` and `eval` read every collection by default and get no row.
 *
 * `CHK_cl_loop_actions_action` gains the curator's `agree` / `edit` / `add` / `remove` and its
 * usage retirement, `retire` (listed in `check-constraints-cover-enums.spec.ts`).
 *
 * Nothing here touches `agent_memories` or `builder_lessons` (the tables): the next migration
 * copies their rows in, and a separate, later one drops them.
 */
const COLLECTIONS: Array<[string, string, string]> = [
  ['builder_lessons', 'Builder Lessons', 'BL'],
  ['bug_hunter_notes', 'Bug Hunter Notes', 'BN'],
];

const GRANTS: Array<[string, string]> = [
  ['builder_interview', 'builder_lessons'],
  ['builder_research', 'builder_lessons'],
  ['builder_prd_review', 'builder_lessons'],
  ['builder_brief', 'builder_lessons'],
  ['builder_build', 'builder_lessons'],
  ['mcp_dev', 'builder_lessons'],
  ['bug_hunter', 'bug_hunter_notes'],
  ['mcp_dev', 'bug_hunter_notes'],
];

const ACTIONS_BEFORE = [
  'archive',
  'demote',
  'promote',
  'learn_query',
  'promote_setup',
  'rollback_setup',
  'merge',
];

export class AddAgentLessonCollections1981000400000 implements MigrationInterface {
  name = 'AddAgentLessonCollections1981000400000';

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
    await queryRunner.query(
      `ALTER TABLE "cl_loop_actions" DROP CONSTRAINT IF EXISTS "CHK_cl_loop_actions_action"`,
    );
    await queryRunner.query(
      `ALTER TABLE "cl_loop_actions" ADD CONSTRAINT "CHK_cl_loop_actions_action" CHECK ("action" IN ('archive', 'demote', 'promote', 'learn_query', 'promote_setup', 'rollback_setup', 'merge', 'agree', 'edit', 'add', 'remove', 'retire'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // The curator's own history goes with the narrower constraint it no longer fits.
    await queryRunner.query(
      `DELETE FROM "cl_loop_actions" WHERE NOT ("action" = ANY($1::text[]))`,
      [ACTIONS_BEFORE],
    );
    await queryRunner.query(
      `ALTER TABLE "cl_loop_actions" DROP CONSTRAINT IF EXISTS "CHK_cl_loop_actions_action"`,
    );
    await queryRunner.query(
      `ALTER TABLE "cl_loop_actions" ADD CONSTRAINT "CHK_cl_loop_actions_action" CHECK ("action" IN ('archive', 'demote', 'promote', 'learn_query', 'promote_setup', 'rollback_setup', 'merge'))`,
    );
    for (const [id] of COLLECTIONS) {
      await queryRunner.query(
        `DELETE FROM "cl_use_case_access" WHERE "collection_id" = $1`,
        [id],
      );
      // Only while empty: a rollback must never take lessons or notes with it.
      await queryRunner.query(
        `DELETE FROM "cl_collections" WHERE "id" = $1
           AND NOT EXISTS (SELECT 1 FROM "cl_chunks" WHERE "collection_id" = $1)`,
        [id],
      );
    }
  }
}
