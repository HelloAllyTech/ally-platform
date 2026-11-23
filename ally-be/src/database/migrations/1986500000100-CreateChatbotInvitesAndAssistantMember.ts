import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Stage 1b — invites to a chatbot's team, and the login role for people invited without an account.
 *
 * 1. The ASSISTANT_MEMBER role (D9): someone invited to a chatbot who had no Ally account, made in
 *    the inviter's organisation. It signs in to the admin portal and holds only the assistants'
 *    read and conversation permissions; everything it can open is decided by chatbot membership
 *    (member routes need no toggle or permission). No `system:access`, no Chatbots feature
 *    toggle, so it can't create a chatbot and is never a platform admin. Platform-managed.
 * 2. `chatbot_invites`: one row per invite, bound to an email (stored lower-case). Only the
 *    SHA-256 of the emailed token is kept. Accepting needs the token AND that email (the signed-in
 *    account's, or the one typed on the public page), so a forwarded link can't be claimed by
 *    someone else's account. At most one pending invite per chatbot and email.
 */
const GROUP = 'ASSISTANT_MEMBER';
const PERMISSIONS = [
  'view:whatsapp-bot',
  'view:whatsapp-bot:conversations',
  'edit:whatsapp-bot:conversations',
];

export class CreateChatbotInvitesAndAssistantMember1986500000100 implements MigrationInterface {
  name = 'CreateChatbotInvitesAndAssistantMember1986500000100';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "groups" ("name")
       SELECT $1::varchar WHERE NOT EXISTS (SELECT 1 FROM "groups" WHERE name = $1::varchar)`,
      [GROUP],
    );
    for (const permission of PERMISSIONS) {
      await queryRunner.query(
        `INSERT INTO "permissions" ("name")
         SELECT $1::varchar WHERE NOT EXISTS (SELECT 1 FROM "permissions" WHERE name = $1::varchar)`,
        [permission],
      );
      await queryRunner.query(
        `INSERT INTO "group_permissions" ("groupId", "permissionId")
         SELECT g.id, p.id FROM "groups" g JOIN "permissions" p ON p.name = $2
          WHERE g.name = $1
            AND NOT EXISTS (SELECT 1 FROM "group_permissions" e
                             WHERE e."groupId" = g.id AND e."permissionId" = p.id)`,
        [GROUP, permission],
      );
    }

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "chatbot_invites" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "chatbot_id" uuid NOT NULL,
        "email" character varying(254) NOT NULL,
        "roles" text[] NOT NULL,
        "invited_by" integer,
        "token_hash" character(64) NOT NULL,
        "expires_at" TIMESTAMPTZ NOT NULL,
        "accepted_at" TIMESTAMPTZ,
        "accepted_user_id" integer,
        "revoked_at" TIMESTAMPTZ,
        "revoked_by" integer,
        CONSTRAINT "PK_chatbot_invites_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_chatbot_invites_chatbot" FOREIGN KEY ("chatbot_id")
          REFERENCES "chatbots"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_chatbot_invites_email_lower" CHECK ("email" = lower("email")),
        CONSTRAINT "CHK_chatbot_invites_roles" CHECK (
          cardinality("roles") > 0
          AND "roles" <@ ARRAY['owner','editor','responder','viewer']::text[])
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_chatbot_invites_token_hash" ON "chatbot_invites" ("token_hash")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_chatbot_invites_pending" ON "chatbot_invites" ("chatbot_id", "email")
        WHERE "accepted_at" IS NULL AND "revoked_at" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "chatbot_invites"`);
    await queryRunner.query(
      `DELETE FROM "user_groups" WHERE "groupId" IN (SELECT id FROM "groups" WHERE name = $1)`,
      [GROUP],
    );
    await queryRunner.query(
      `DELETE FROM "group_permissions" WHERE "groupId" IN (SELECT id FROM "groups" WHERE name = $1)`,
      [GROUP],
    );
    await queryRunner.query(`DELETE FROM "groups" WHERE name = $1`, [GROUP]);
  }
}
