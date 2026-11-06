import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agents v2, chunk 2: the per-bot engine switch.
 *
 * - `chatbots.runtime` picks the engine per bot (v1, shadow or v2), and every existing bot stays on
 *   v1. `features` holds the v2 feature flags later chunks add.
 * - `wa_messages.agent_run_id` / `agent_runtime` link a reply to the run that produced it. The table
 *   has no metadata column to put them in.
 * - `agent_shadow_runs` compares v1 and v2 on the same live messages, without any message text.
 *
 * The platform kill switch (`agentRuntimeAllowed`, off) needs no data change: settings defaults are
 * merged over the stored `whatsapp_bot` row field by field.
 */
export class AddChatbotAgentRuntime1980930000000 implements MigrationInterface {
  name = 'AddChatbotAgentRuntime1980930000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "chatbots" ADD "runtime" character varying(16) NOT NULL DEFAULT 'v1'`,
    );
    await queryRunner.query(
      `ALTER TABLE "chatbots" ADD CONSTRAINT "chk_chatbots_runtime" CHECK ("runtime" IN ('v1', 'shadow', 'v2'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "chatbots" ADD "features" jsonb NOT NULL DEFAULT '{}'`,
    );

    await queryRunner.query(
      `ALTER TABLE "wa_messages" ADD "agent_run_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "wa_messages" ADD "agent_runtime" character varying(16)`,
    );
    await queryRunner.query(
      `ALTER TABLE "wa_messages" ADD CONSTRAINT "chk_wa_messages_agent_runtime" CHECK ("agent_runtime" IN ('v2', 'v2_fallback'))`,
    );

    await queryRunner.query(
      `CREATE TABLE "agent_shadow_runs" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "chatbot_id" uuid NOT NULL, "conversation_id" uuid NOT NULL, "inbound_message_id" uuid NOT NULL, "run_id" uuid NOT NULL, "v1" jsonb NOT NULL, "v2" jsonb, "error" text, CONSTRAINT "PK_agent_shadow_runs_id" PRIMARY KEY ("id"), CONSTRAINT "FK_agent_shadow_runs_chatbot" FOREIGN KEY ("chatbot_id") REFERENCES "chatbots"("id") ON DELETE CASCADE)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_agent_shadow_runs_inbound" ON "agent_shadow_runs" ("inbound_message_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_agent_shadow_runs_chatbot" ON "agent_shadow_runs" ("chatbot_id", "createdAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "agent_shadow_runs"`);
    await queryRunner.query(
      `ALTER TABLE "wa_messages" DROP CONSTRAINT "chk_wa_messages_agent_runtime"`,
    );
    await queryRunner.query(
      `ALTER TABLE "wa_messages" DROP COLUMN "agent_runtime"`,
    );
    await queryRunner.query(
      `ALTER TABLE "wa_messages" DROP COLUMN "agent_run_id"`,
    );
    await queryRunner.query(`ALTER TABLE "chatbots" DROP COLUMN "features"`);
    await queryRunner.query(
      `ALTER TABLE "chatbots" DROP CONSTRAINT "chk_chatbots_runtime"`,
    );
    await queryRunner.query(`ALTER TABLE "chatbots" DROP COLUMN "runtime"`);
  }
}
