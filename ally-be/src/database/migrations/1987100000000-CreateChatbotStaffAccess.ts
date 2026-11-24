import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Assistants stage 8 — Ally staff's read-only view of any chatbot.
 *
 * - `chatbot_access_grants`: an owner's time-limited permission for Ally staff to read
 *   conversations (scope `ally_staff`; at most 7 days, enforced in code and by a CHECK).
 * - `chatbot_staff_views`: one row per staff read, written before the read is served.
 *
 * Additive only (expand-contract safe). New tables, so the CHECK constraints have no old rows.
 */
export class CreateChatbotStaffAccess1987100000000 implements MigrationInterface {
  name = 'CreateChatbotStaffAccess1987100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "chatbot_access_grants" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "chatbot_id" uuid NOT NULL,
        "granted_by" integer NOT NULL,
        "scope" character varying(32) NOT NULL DEFAULT 'ally_staff',
        "reason" text,
        "expires_at" TIMESTAMPTZ NOT NULL,
        "revoked_at" TIMESTAMPTZ,
        "revoked_by" integer,
        "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_chatbot_access_grants_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_chatbot_access_grants_chatbot" FOREIGN KEY ("chatbot_id")
          REFERENCES "chatbots"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_chatbot_access_grants_scope" CHECK ("scope" IN ('ally_staff')),
        CONSTRAINT "CHK_chatbot_access_grants_window"
          CHECK ("expires_at" > "created_at"
             AND "expires_at" <= "created_at" + interval '7 days 1 minute')
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_chatbot_access_grants_bot_expires"
         ON "chatbot_access_grants" ("chatbot_id", "expires_at")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "chatbot_staff_views" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "chatbot_id" uuid,
        "staff_user_id" integer NOT NULL,
        "policy" character varying(24) NOT NULL,
        "route" character varying(255) NOT NULL,
        "handler" character varying(128) NOT NULL,
        "conversation_id" uuid,
        "target" character varying(255),
        "grant_id" uuid,
        "viewed_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT "PK_chatbot_staff_views_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_chatbot_staff_views_chatbot" FOREIGN KEY ("chatbot_id")
          REFERENCES "chatbots"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_chatbot_staff_views_policy"
          CHECK ("policy" IN ('setup', 'conversations', 'search'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_chatbot_staff_views_bot_at"
         ON "chatbot_staff_views" ("chatbot_id", "viewed_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "chatbot_staff_views"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "chatbot_access_grants"`);
  }
}
