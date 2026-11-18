import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Context Library, phase 8 (the dead-code sweep): remove the two curator prompts phase 5 retired.
 *
 * `agent_memory_curator_system` (Bug Hunter's notebook curator) and
 * `builder_lesson_curator_system` (Builder's lesson curator) were replaced by one agent-chunk
 * curator, `context_library_agent_curator_system`, when Bug Hunter's notes and Builder's lessons
 * moved into the Context Library. Their defaults and contracts were deleted then; their Skills
 * Store rows stayed, live but unread, because ally-be's own codes are never auto-obsoleted by sync.
 *
 * Same shape as `1980750000000-RemoveUnusedPrompts`: guarded so a row that gained a user since is
 * skipped rather than deleted (no scenario may select it, no skill experiment may point at it);
 * versions and translations are deleted explicitly. Sync refuses to recreate the codes
 * (`REMOVED_PROMPT_CODES`), so an older ally-be build restarting mid-deploy cannot bring them back.
 *
 * `down` restores nothing. The defaults are in Git history and the rows as they stood before the
 * Skills Store in the snapshot tables `1980150000000` creates; a version published after that is
 * not kept, since nothing has run it since phase 5 and the curators it configured are gone.
 */
export const RETIRED_CURATOR_PROMPT_CODES = [
  'agent_memory_curator_system',
  'builder_lesson_curator_system',
];

export class RemoveRetiredCuratorPrompts1981001200000 implements MigrationInterface {
  name = 'RemoveRetiredCuratorPrompts1981001200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const removable = `
      SELECT p."id" FROM "prompts" p
      WHERE p."promptCode" = ANY($1)
        AND NOT EXISTS (
          SELECT 1 FROM "scenarios" s
          WHERE s."metadata"->>'selectedMainPromptCode' = p."promptCode"
        )
        AND NOT EXISTS (
          SELECT 1 FROM "skill_experiments" e WHERE e."promptId" = p."id"
        )`;
    await queryRunner.query(
      `DELETE FROM "prompt_translations" WHERE "promptId" IN (${removable})`,
      [RETIRED_CURATOR_PROMPT_CODES],
    );
    await queryRunner.query(
      `DELETE FROM "prompts_versions" WHERE "promptId" IN (${removable})`,
      [RETIRED_CURATOR_PROMPT_CODES],
    );
    await queryRunner.query(
      `DELETE FROM "prompts" WHERE "id" IN (${removable})`,
      [RETIRED_CURATOR_PROMPT_CODES],
    );
  }

  public async down(): Promise<void> {
    // Nothing to restore: see the header.
  }
}
