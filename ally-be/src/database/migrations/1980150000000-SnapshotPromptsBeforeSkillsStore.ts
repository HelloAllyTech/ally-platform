import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Snapshot the prompt tables before the Skills Store migrations change them,
 * so the move loses no information.
 *
 * Runs before `1980200000000-SkillsStoreVersioning` and
 * `1980750000000-RemoveUnusedPrompts` (TypeORM runs pending migrations in
 * timestamp order), and before the first sync of the new code. What those
 * steps change and this keeps:
 *
 * - the 26 prompt rows `RemoveUnusedPrompts` deletes, with their versions and
 *   translations (most of their text was never in Git);
 * - every row's `defaultPrompt`, which the first sync overwrites with the
 *   minimal base from Git (the old full defaults otherwise survive only in Git
 *   history);
 * - the override flags, `currentVersion` pointers and model settings exactly
 *   as they were.
 *
 * Plain copies (`CREATE TABLE ... AS TABLE`): no constraints, no foreign keys,
 * nothing reads them. To recover a row, select it from the snapshot. Drop the
 * tables once the Skills Store has run in production for a while.
 */
const SNAPSHOTS: Array<[source: string, snapshot: string]> = [
  ['prompts', 'prompts_snapshot_pre_skills_store'],
  ['prompts_versions', 'prompts_versions_snapshot_pre_skills_store'],
  ['prompt_translations', 'prompt_translations_snapshot_pre_skills_store'],
];

export class SnapshotPromptsBeforeSkillsStore1980150000000 implements MigrationInterface {
  name = 'SnapshotPromptsBeforeSkillsStore1980150000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [source, snapshot] of SNAPSHOTS) {
      // IF NOT EXISTS: a re-run never replaces the first, pre-change copy.
      await queryRunner.query(
        `CREATE TABLE IF NOT EXISTS "${snapshot}" AS TABLE "${source}"`,
      );
      await queryRunner.query(
        `COMMENT ON TABLE "${snapshot}" IS 'Copy of ${source} taken before the Skills Store migrations (1980150000000). Read-only archive; safe to drop once the Skills Store is settled in production.'`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [, snapshot] of SNAPSHOTS) {
      await queryRunner.query(`DROP TABLE IF EXISTS "${snapshot}"`);
    }
  }
}
