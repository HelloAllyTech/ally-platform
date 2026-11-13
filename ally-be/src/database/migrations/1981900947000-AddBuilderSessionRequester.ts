import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A Builder session can be requested on behalf of an agent (plan §11.5, FR-63):
 * `requestedBy` names the requester (today only `debrief_pm_agent`, "Hand to
 * Builder" on a PM agent idea) and `requestRef` its own id for the work (the
 * idea id). Both null for a session a person started. The requester is told
 * when an interview turn ends, so it can answer Builder's question itself.
 * Columns rather than `metadata` keys: the interview-summary writer replaces
 * `metadata` wholesale.
 *
 * Builder History gets the surface `requester` for an answer the requester gave
 * (on nobody's behalf, like `rule`). Down rewrites those rows as `rule` first.
 */
export class AddBuilderSessionRequester1981900947000 implements MigrationInterface {
  name = 'AddBuilderSessionRequester1981900947000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "builder_sessions" ADD COLUMN IF NOT EXISTS "requestedBy" varchar(32) NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_sessions" ADD COLUMN IF NOT EXISTS "requestRef" varchar(64) NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_builder_sessions_request" ON "builder_sessions" ("requestedBy", "requestRef") WHERE "requestedBy" IS NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_history" DROP CONSTRAINT IF EXISTS "CHK_builder_history_surface"`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_history" ADD CONSTRAINT "CHK_builder_history_surface" CHECK ("surface" IN ('now', 'session', 'slack', 'rule', 'requester'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "builder_history" SET "surface" = 'rule' WHERE "surface" = 'requester'`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_history" DROP CONSTRAINT IF EXISTS "CHK_builder_history_surface"`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_history" ADD CONSTRAINT "CHK_builder_history_surface" CHECK ("surface" IN ('now', 'session', 'slack', 'rule'))`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_builder_sessions_request"`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_sessions" DROP COLUMN IF EXISTS "requestRef"`,
    );
    await queryRunner.query(
      `ALTER TABLE "builder_sessions" DROP COLUMN IF EXISTS "requestedBy"`,
    );
  }
}
