import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Saved Analytics Agent conversations (Analytics → Agent tab).
 *
 *  - `analytics_agent_conversations` — one row per thread, owned by one user,
 *    titled with the first question asked.
 *  - `analytics_agent_messages` — one row per turn (question + the agent's full
 *    response as jsonb), cascading from its conversation.
 *
 * Both cascade: deleting a user deletes their conversations, deleting a
 * conversation deletes its turns. Additive only; no CHECK constraints, so
 * nothing here needs listing in check-constraints-cover-enums.spec.ts.
 */
export class CreateAnalyticsAgentConversations1984305000000 implements MigrationInterface {
  name = 'CreateAnalyticsAgentConversations1984305000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "analytics_agent_conversations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" integer NOT NULL,
        "title" character varying(120) NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_analytics_agent_conversations_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_analytics_agent_conversations_user" FOREIGN KEY ("userId")
          REFERENCES "users"("id") ON DELETE CASCADE
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_analytics_agent_conversations_user_updated"
        ON "analytics_agent_conversations" ("userId", "updatedAt")`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "analytics_agent_messages" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "conversationId" uuid NOT NULL,
        "question" text NOT NULL,
        "outcome" character varying(16) NOT NULL,
        "response" jsonb NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_analytics_agent_messages_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_analytics_agent_messages_conversation" FOREIGN KEY ("conversationId")
          REFERENCES "analytics_agent_conversations"("id") ON DELETE CASCADE
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_analytics_agent_messages_conversation_created"
        ON "analytics_agent_messages" ("conversationId", "createdAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_analytics_agent_messages_conversation_created"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "analytics_agent_messages"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_analytics_agent_conversations_user_updated"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "analytics_agent_conversations"`,
    );
  }
}
