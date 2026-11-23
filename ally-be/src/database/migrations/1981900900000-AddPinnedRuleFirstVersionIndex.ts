import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Pinned rules' approval flow (decided 2026-11-12): each pinned rule whose
 * version in force was never approved gets one "Needs you" item in the PM
 * agent's Ideas, "Approve the current Safety rules (v1)". ally-be creates
 * them at boot and whenever the PM agent page or Settings › Pinned rules is
 * read, from several instances at once; this partial unique index makes the
 * second insert a no-op (`ON CONFLICT DO NOTHING`), one item per rule and
 * version. It covers only first-version items, so the PM agent's own ideas,
 * which may share a hash once rejected, are untouched.
 *
 * Hand-written SQL.
 */
export class AddPinnedRuleFirstVersionIndex1981900900000 implements MigrationInterface {
  name = 'AddPinnedRuleFirstVersionIndex1981900900000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_agent_lessons_pinned_rule_first_version"
        ON "agent_lessons" ("agentKey", "contentHash")
        WHERE (change->>'firstVersion') = 'true'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_agent_lessons_pinned_rule_first_version"`,
    );
  }
}
