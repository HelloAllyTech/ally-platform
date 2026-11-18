import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Organisations' own WhatsApp Business numbers for the Q&A bot.
 *
 * Until now the bot was one platform number read from env vars. An org-scoped admin can now
 * connect their organisation's own number; every message to it is answered from that
 * organisation's documents, with that organisation's settings, and the reply goes out with that
 * number's credentials. The env number keeps working untouched and has no row here.
 *
 * Partial unique indexes on live rows for the tenant (one number per organisation in v1), the
 * Meta phone number id (the routing key — two claims on one number would make inbound ambiguous)
 * and the webhook key (the path segment that picks the app secret a signature is checked with).
 *
 * `wa_contacts` gains `business_number_id`. Its uniqueness moves from the phone alone to the
 * (phone, number) pair, so a worker writing to two organisations' numbers gets two threads with
 * separate consent and rate limits. Every existing row is a platform-number contact (NULL), and
 * the original index name is kept for exactly those rows, so nothing already stored changes.
 */
export class CreateWaBusinessNumbers1980885000000 implements MigrationInterface {
  name = 'CreateWaBusinessNumbers1980885000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "wa_business_numbers" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "phone_number_id" character varying(64) NOT NULL, "waba_id" character varying(64) NOT NULL, "display_phone_number" character varying(32), "verified_name" text, "access_token_enc" text NOT NULL, "app_secret_enc" text, "webhook_key" character varying(64) NOT NULL, "verify_token" character varying(64) NOT NULL, "source" character varying(24) NOT NULL, "status" character varying(24) NOT NULL, "last_checked_at" TIMESTAMP, "last_error" text, "settings" jsonb NOT NULL DEFAULT '{}', "created_by" integer NOT NULL, "updated_by" integer, "deletedAt" TIMESTAMP, CONSTRAINT "PK_wa_business_numbers_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_wa_business_numbers_tenant" ON "wa_business_numbers" ("tenant_id") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_wa_business_numbers_phone_number_id" ON "wa_business_numbers" ("phone_number_id") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_wa_business_numbers_webhook_key" ON "wa_business_numbers" ("webhook_key") WHERE "deletedAt" IS NULL`,
    );

    await queryRunner.query(
      `ALTER TABLE "wa_contacts" ADD "business_number_id" uuid`,
    );
    await queryRunner.query(`DROP INDEX "public"."uq_wa_contacts_phone"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_wa_contacts_phone" ON "wa_contacts" ("phone_e164") WHERE "business_number_id" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_wa_contacts_phone_number" ON "wa_contacts" ("phone_e164", "business_number_id") WHERE "business_number_id" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Org-number contacts cannot survive a phone-only unique index — the same worker may have
    // written to several numbers. They go with the table they point at.
    await queryRunner.query(
      `DELETE FROM "wa_contacts" WHERE "business_number_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."uq_wa_contacts_phone_number"`,
    );
    await queryRunner.query(`DROP INDEX "public"."uq_wa_contacts_phone"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_wa_contacts_phone" ON "wa_contacts" ("phone_e164")`,
    );
    await queryRunner.query(
      `ALTER TABLE "wa_contacts" DROP COLUMN "business_number_id"`,
    );

    await queryRunner.query(
      `DROP INDEX "public"."uq_wa_business_numbers_webhook_key"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."uq_wa_business_numbers_phone_number_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."uq_wa_business_numbers_tenant"`,
    );
    await queryRunner.query(`DROP TABLE "wa_business_numbers"`);
  }
}
