import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Canary releases (plans/ally-guide/plan.md §7.4) audit two new actions,
 * `canary_started` and `canary_stopped`. Without this the CHECK constraint
 * refuses the audit row and starting a canary fails on a real database.
 */
export class WidenAgentReleaseAuditActions1980695000000 implements MigrationInterface {
  name = 'WidenAgentReleaseAuditActions1980695000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "agent_release_audit" DROP CONSTRAINT IF EXISTS "CHK_agent_release_audit_action"`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_release_audit" ADD CONSTRAINT "CHK_agent_release_audit_action" CHECK ("action" IN (
        'created', 'status_changed', 'promoted', 'rolled_back',
        'emergency_rollback', 'canary_started', 'canary_stopped', 'note'
      ))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "agent_release_audit" WHERE "action" IN ('canary_started', 'canary_stopped')`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_release_audit" DROP CONSTRAINT IF EXISTS "CHK_agent_release_audit_action"`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_release_audit" ADD CONSTRAINT "CHK_agent_release_audit_action" CHECK ("action" IN (
        'created', 'status_changed', 'promoted', 'rolled_back',
        'emergency_rollback', 'note'
      ))`,
    );
  }
}
