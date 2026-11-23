import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agents v2, chunk 3b: the tool gateway. `tool_runs` holds one row per gateway call, claimed
 * (`started`) before the tool runs and then recorded `ok` or `error`. It is unique on run id and
 * step, so a redelivered message's replayed call returns the stored result instead of acting twice.
 * `conversation_id` is text because Preview's `preview-…` ids aren't stored conversations.
 *
 * Needs a person gains a third reason, `assistant`: the agent's `hand_over` tool.
 *
 * Down puts `assistant` reasons back to `asked` first, so the old constraint can be re-added.
 */
export class AddToolRuns1981900949000 implements MigrationInterface {
  name = 'AddToolRuns1981900949000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "tool_runs" (
         "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
         "chatbot_id" uuid NOT NULL,
         "conversation_id" text NOT NULL,
         "run_id" text NOT NULL,
         "step" integer NOT NULL,
         "tool" character varying(64) NOT NULL,
         "input" jsonb NOT NULL DEFAULT '{}',
         "status" character varying(16) NOT NULL,
         "result" jsonb,
         "error_code" character varying(64),
         "duration_ms" integer,
         "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
         "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
         CONSTRAINT "PK_tool_runs" PRIMARY KEY ("id"),
         CONSTRAINT "UQ_tool_runs_run_step" UNIQUE ("run_id", "step"),
         CONSTRAINT "CHK_tool_runs_status" CHECK ("status" IN ('started', 'ok', 'error')),
         CONSTRAINT "FK_tool_runs_chatbot" FOREIGN KEY ("chatbot_id") REFERENCES "chatbots"("id") ON DELETE CASCADE
       )`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_tool_runs_conversation" ON "tool_runs" ("conversation_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_tool_runs_created" ON "tool_runs" ("createdAt")`,
    );
    await queryRunner.query(
      `ALTER TABLE "chatbot_conversations" DROP CONSTRAINT "CHK_chatbot_conversations_needs_person_reason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "chatbot_conversations" ADD CONSTRAINT "CHK_chatbot_conversations_needs_person_reason" CHECK ("needs_person_reason" IS NULL OR "needs_person_reason" IN ('asked', 'declined_twice', 'assistant'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "chatbot_conversations" SET "needs_person_reason" = 'asked' WHERE "needs_person_reason" = 'assistant'`,
    );
    await queryRunner.query(
      `ALTER TABLE "chatbot_conversations" DROP CONSTRAINT "CHK_chatbot_conversations_needs_person_reason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "chatbot_conversations" ADD CONSTRAINT "CHK_chatbot_conversations_needs_person_reason" CHECK ("needs_person_reason" IS NULL OR "needs_person_reason" IN ('asked', 'declined_twice'))`,
    );
    await queryRunner.query(`DROP TABLE "tool_runs"`);
  }
}
