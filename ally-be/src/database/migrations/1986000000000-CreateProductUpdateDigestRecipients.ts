import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Who gets the daily product-updates email, managed from the admin console.
 *
 * Until now the list was only the `PRODUCT_UPDATES_DIGEST_TO` env var, which
 * needs someone with S3 access and a forced deploy to change. This table
 * replaces it (the env var is no longer read). The table starts empty on
 * purpose: this repo is public, so no address is written into it. Recipients are
 * added in the admin console after deploy, and until then no email is sent.
 * `down` drops the table; it does not restore the env var.
 *
 * Platform-wide, not tenant-scoped. `email` is stored lower-cased and is unique.
 * Hand-written, like every recent CREATE here.
 */
export class CreateProductUpdateDigestRecipients1986000000000 implements MigrationInterface {
  name = 'CreateProductUpdateDigestRecipients1986000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "product_update_digest_recipients" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "email" character varying(254) NOT NULL,
        "added_by" integer,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_product_update_digest_recipients" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_product_update_digest_recipients_email_lower"
          CHECK ("email" = lower("email"))
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_product_update_digest_recipients_email" ON "product_update_digest_recipients" ("email")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "product_update_digest_recipients"`,
    );
  }
}
