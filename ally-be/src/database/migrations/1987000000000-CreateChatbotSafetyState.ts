import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Stage 4 (safety core): what the go-live gate reads that an editor's settings save must never
 * write or wipe — the safety terms an owner accepted, the per-language crisis check results, and
 * whether the unpublish backfill (D10) paused the chatbot and why.
 *
 * Its own table, not `chatbots.settings`: that jsonb is replaced whole by every settings save, so a
 * value kept there could be forged ("terms accepted") or dropped by a stale form. Expand only.
 */
export class CreateChatbotSafetyState1987000000000 implements MigrationInterface {
  name = 'CreateChatbotSafetyState1987000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "chatbot_safety_state" (
        "chatbot_id" uuid PRIMARY KEY REFERENCES "chatbots"("id") ON DELETE CASCADE,
        "terms_version" varchar(32),
        "terms_accepted_at" timestamptz,
        "terms_accepted_by" integer,
        "language_crisis_status" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "paused_by_gate_at" timestamptz,
        "paused_by_gate_reason" jsonb,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_chatbot_safety_state_paused" ON "chatbot_safety_state" ("paused_by_gate_at") WHERE "paused_by_gate_at" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_chatbot_safety_state_paused"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "chatbot_safety_state"`);
  }
}
