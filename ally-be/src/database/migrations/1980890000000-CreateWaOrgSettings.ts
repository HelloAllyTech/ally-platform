import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-organisation WhatsApp bot settings, moved off the connected number.
 *
 * CreateWaBusinessNumbers1980885000000 kept an organisation's overrides on its number row. That
 * tied wording and helplines to having a number: an organisation could not prepare them before
 * connecting, and a disconnect discarded what its admins wrote. They now live one row per
 * organisation, and the number keeps only what it needs to send and receive.
 *
 * Existing overrides are copied across (live numbers only, and only when something was set)
 * before the column is dropped.
 */
export class CreateWaOrgSettings1980890000000 implements MigrationInterface {
  name = 'CreateWaOrgSettings1980890000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "wa_org_settings" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "settings" jsonb NOT NULL DEFAULT '{}', "created_by" integer NOT NULL, "updated_by" integer, CONSTRAINT "PK_wa_org_settings_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_wa_org_settings_tenant" ON "wa_org_settings" ("tenant_id")`,
    );
    await queryRunner.query(
      `INSERT INTO "wa_org_settings" ("tenant_id", "settings", "created_by", "updated_by")
       SELECT "tenant_id", "settings", "created_by", "updated_by"
         FROM "wa_business_numbers"
        WHERE "deletedAt" IS NULL AND "settings" <> '{}'::jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "wa_business_numbers" DROP COLUMN "settings"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "wa_business_numbers" ADD "settings" jsonb NOT NULL DEFAULT '{}'`,
    );
    await queryRunner.query(
      `UPDATE "wa_business_numbers" n SET "settings" = s."settings"
         FROM "wa_org_settings" s
        WHERE s."tenant_id" = n."tenant_id" AND n."deletedAt" IS NULL`,
    );
    await queryRunner.query(`DROP INDEX "public"."uq_wa_org_settings_tenant"`);
    await queryRunner.query(`DROP TABLE "wa_org_settings"`);
  }
}
