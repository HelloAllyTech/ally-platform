import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agents v2: the leftovers of the per-bot engine go.
 *
 * - `agent_shadow_runs`: shadow mode (v1 answers, v2 runs afterwards for comparison) is removed.
 * - `chatbots.runtime` and `chatbots.features`: every bot answers with the agent since chunk 3d and
 *   neither column was read any more. The engine follows the platform emergency switch
 *   (`agentRuntimeAllowed`) alone; v1 stays only as that switch's engine and as v2's fallback.
 *
 * `wa_messages.agent_run_id` / `agent_runtime` stay: they still record which run answered.
 *
 * `down` recreates the table empty and the columns as chunk 3d left them: every bot on v2 with
 * Agent mode on.
 */
export class RemoveChatbotShadowAndStoredEngine1980980000000 implements MigrationInterface {
  name = 'RemoveChatbotShadowAndStoredEngine1980980000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "agent_shadow_runs"`);
    await queryRunner.query(
      `ALTER TABLE "chatbots" DROP CONSTRAINT IF EXISTS "chk_chatbots_runtime"`,
    );
    await queryRunner.query(
      `ALTER TABLE "chatbots" DROP COLUMN IF EXISTS "runtime"`,
    );
    await queryRunner.query(
      `ALTER TABLE "chatbots" DROP COLUMN IF EXISTS "features"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "chatbots" ADD "runtime" character varying(16) NOT NULL DEFAULT 'v2'`,
    );
    await queryRunner.query(
      `ALTER TABLE "chatbots" ADD CONSTRAINT "chk_chatbots_runtime" CHECK ("runtime" IN ('v1', 'shadow', 'v2'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "chatbots" ADD "features" jsonb NOT NULL DEFAULT '{"agent": true}'`,
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
}
