import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Stage 1b — a chatbot member's roles become a set (owner, editor, responder, viewer).
 *
 * Expand only. `chatbot_members.roles text[]` is added and backfilled from the old single `role`,
 * which stays and stays written (dual write) until a later release drops it.
 *
 * Mid-deploy an instance still on the old code writes only `role` (and an INSERT without `roles`).
 * The trigger keeps the two in step whichever side wrote:
 * - INSERT with no `roles`: `roles` = {role};
 * - INSERT or UPDATE that sets `roles`: `role` = the highest of the set on the old ladder
 *   (owner > editor > viewer; a responder-only member is `viewer`);
 * - UPDATE that changes only `role` (an old instance): the ladder part of `roles` follows it and a
 *   `responder` already held is kept.
 */
export class ChatbotMemberRoleSets1986500000000 implements MigrationInterface {
  name = 'ChatbotMemberRoleSets1986500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "chatbot_members" ADD COLUMN IF NOT EXISTS "roles" text[]`,
    );
    await queryRunner.query(
      `UPDATE "chatbot_members" SET "roles" = ARRAY[lower("role")]::text[] WHERE "roles" IS NULL`,
    );

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION chatbot_member_legacy_role(r text[]) RETURNS varchar
      LANGUAGE sql IMMUTABLE AS $$
        SELECT CASE
          WHEN 'owner' = ANY(r) THEN 'owner'
          WHEN 'editor' = ANY(r) THEN 'editor'
          ELSE 'viewer'
        END
      $$
    `);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION chatbot_members_sync_roles() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP = 'INSERT' THEN
          IF NEW.roles IS NULL OR cardinality(NEW.roles) = 0 THEN
            NEW.roles := ARRAY[lower(NEW.role)]::text[];
          ELSE
            NEW.role := chatbot_member_legacy_role(NEW.roles);
          END IF;
        ELSIF NEW.roles IS DISTINCT FROM OLD.roles THEN
          NEW.role := chatbot_member_legacy_role(NEW.roles);
        ELSIF NEW.role IS DISTINCT FROM OLD.role THEN
          NEW.roles := ARRAY[lower(NEW.role)]::text[]
            || CASE WHEN 'responder' = ANY(OLD.roles) AND lower(NEW.role) <> 'responder'
                    THEN ARRAY['responder']::text[] ELSE ARRAY[]::text[] END;
        END IF;
        RETURN NEW;
      END
      $$
    `);
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "TRG_chatbot_members_sync_roles" ON "chatbot_members"`,
    );
    await queryRunner.query(`
      CREATE TRIGGER "TRG_chatbot_members_sync_roles"
      BEFORE INSERT OR UPDATE ON "chatbot_members"
      FOR EACH ROW EXECUTE FUNCTION chatbot_members_sync_roles()
    `);

    await queryRunner.query(
      `ALTER TABLE "chatbot_members" ALTER COLUMN "roles" SET NOT NULL`,
    );
    await queryRunner.query(`
      ALTER TABLE "chatbot_members"
        ADD CONSTRAINT "CHK_chatbot_members_roles"
        CHECK (cardinality("roles") > 0
               AND "roles" <@ ARRAY['owner','editor','responder','viewer']::text[])
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_chatbot_members_roles" ON "chatbot_members" USING GIN ("roles")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_chatbot_members_roles"`);
    await queryRunner.query(
      `ALTER TABLE "chatbot_members" DROP CONSTRAINT IF EXISTS "CHK_chatbot_members_roles"`,
    );
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "TRG_chatbot_members_sync_roles" ON "chatbot_members"`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS chatbot_members_sync_roles()`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS chatbot_member_legacy_role(text[])`,
    );
    await queryRunner.query(
      `ALTER TABLE "chatbot_members" DROP COLUMN IF EXISTS "roles"`,
    );
  }
}
