import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The roleplay interview (Studio's Agent Builder Copilot as a chat): its
 * sessions and transcript. It produces normal Studio roleplays and keeps no
 * engine of its own.
 */
export class CreateRoleplayInterview1986600000000 implements MigrationInterface {
  name = 'CreateRoleplayInterview1986600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "roleplay_interview_sessions" (` +
        `"id" uuid NOT NULL DEFAULT uuid_generate_v4(), ` +
        `"createdBy" integer NOT NULL, ` +
        `"tenantId" uuid, ` +
        `"scenarioId" integer, ` +
        `"status" character varying NOT NULL DEFAULT 'INTERVIEWING', ` +
        `"brief" jsonb NOT NULL DEFAULT '{}', ` +
        `"plan" jsonb, ` +
        `"planVersion" integer NOT NULL DEFAULT 0, ` +
        `"approvedAt" TIMESTAMP, ` +
        `"createdAt" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `"updatedAt" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "PK_roleplay_interview_sessions_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_roleplay_interview_sessions_created_by" ` +
        `ON "roleplay_interview_sessions" ("createdBy")`,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "roleplay_interview_messages" (` +
        `"id" uuid NOT NULL DEFAULT uuid_generate_v4(), ` +
        `"sessionId" uuid NOT NULL, ` +
        `"seq" integer NOT NULL, ` +
        `"role" character varying NOT NULL, ` +
        `"content" text, ` +
        `"toolCalls" jsonb, ` +
        `"toolResults" jsonb, ` +
        `"metadata" jsonb, ` +
        `"createdBy" integer, ` +
        `"createdAt" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "PK_roleplay_interview_messages_id" PRIMARY KEY ("id"), ` +
        `CONSTRAINT "FK_roleplay_interview_messages_session" FOREIGN KEY ("sessionId") ` +
        `REFERENCES "roleplay_interview_sessions"("id") ON DELETE CASCADE)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_roleplay_interview_messages_session_seq" ` +
        `ON "roleplay_interview_messages" ("sessionId", "seq")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."idx_roleplay_interview_messages_session_seq"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "roleplay_interview_messages"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."idx_roleplay_interview_sessions_created_by"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "roleplay_interview_sessions"`,
    );
  }
}
