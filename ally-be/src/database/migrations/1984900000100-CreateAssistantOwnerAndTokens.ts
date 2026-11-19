import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CR1 Part B — custom logins become a limited role with a token allowance.
 *
 * 1. The ASSISTANT_OWNER role: the assistants permissions only, never `system:access`, so its
 *    holders are scoped to their own organisation and are not platform admins. Existing custom
 *    logins are moved onto it by `npm run custom-logins:migrate` (dry run first), not here.
 * 2. `token_grants`: each allowance Ally assigns — an amount, optionally renewing monthly on its
 *    own day or expiring. `remaining` is what's left of it this period; usage is taken from the
 *    oldest grant first. Revoking zeroes `remaining`; used tokens stay used.
 * 3. `token_balances`: one row per user who has an allowance (or is unlimited). `overdraft` is what
 *    a run used past zero ("may dip below zero by at most one run"), taken from the next grant or
 *    renewal. Updated in the same transaction as each usage event, under a row lock.
 *
 * Users without a row are unaffected.
 */
const GROUP = 'ASSISTANT_OWNER';
const PERMISSIONS = [
  'view:whatsapp-bot',
  'edit:whatsapp-bot',
  'view:whatsapp-bot:templates',
  'edit:whatsapp-bot:templates',
  'view:whatsapp-bot:conversations',
  'edit:whatsapp-bot:conversations',
  'view:whatsapp-bot:unanswered',
  'edit:whatsapp-bot:unanswered',
  'view:whatsapp-bot:analytics',
];

export class CreateAssistantOwnerAndTokens1984900000100 implements MigrationInterface {
  name = 'CreateAssistantOwnerAndTokens1984900000100';

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
      CREATE TABLE "token_grants" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "userId" integer NOT NULL,
        "amount" bigint NOT NULL,
        "remaining" bigint NOT NULL,
        "used" bigint NOT NULL DEFAULT 0,
        "renewMonthly" boolean NOT NULL DEFAULT false,
        "renewDay" smallint,
        "nextRenewalAt" TIMESTAMP,
        "expiresAt" TIMESTAMP,
        "status" character varying(20) NOT NULL DEFAULT 'active',
        "note" text NOT NULL,
        "createdBy" integer,
        CONSTRAINT "PK_token_grants_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_token_grants_status" CHECK ("status" IN ('active','revoked','expired')),
        CONSTRAINT "CHK_token_grants_amount" CHECK ("amount" > 0),
        CONSTRAINT "CHK_token_grants_remaining" CHECK ("remaining" >= 0),
        CONSTRAINT "CHK_token_grants_renew_day" CHECK ("renewDay" IS NULL OR "renewDay" BETWEEN 1 AND 28)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_token_grants_user" ON "token_grants" ("userId", "status")`,
    );

    await queryRunner.query(`
      CREATE TABLE "token_balances" (
        "userId" integer NOT NULL,
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "unlimited" boolean NOT NULL DEFAULT false,
        "overdraft" bigint NOT NULL DEFAULT 0,
        "usedThisMonth" bigint NOT NULL DEFAULT 0,
        "monthStart" date NOT NULL DEFAULT date_trunc('month', now())::date,
        CONSTRAINT "PK_token_balances_user" PRIMARY KEY ("userId"),
        CONSTRAINT "CHK_token_balances_overdraft" CHECK ("overdraft" >= 0)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "token_balances"`);
    await queryRunner.query(`DROP TABLE "token_grants"`);
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
