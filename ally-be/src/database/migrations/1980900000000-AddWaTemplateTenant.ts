import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-organisation keyword replies.
 *
 * `tenant_id` NULL is a global reply (every existing row). An organisation's row is either its
 * own reply or, with `overrides_template_id`, its version of a global one. At most one live
 * override per (organisation, global reply), so "Reset to default" is unambiguous.
 */
export class AddWaTemplateTenant1980900000000 implements MigrationInterface {
  name = 'AddWaTemplateTenant1980900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "wa_keyword_templates" ADD "tenant_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "wa_keyword_templates" ADD "overrides_template_id" uuid`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_wa_keyword_templates_tenant" ON "wa_keyword_templates" ("tenant_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_wa_keyword_templates_override" ON "wa_keyword_templates" ("tenant_id", "overrides_template_id") WHERE "overrides_template_id" IS NOT NULL AND "archived_at" IS NULL`,
    );
    // Every per-organisation activity query filters contacts by the number they wrote to.
    await queryRunner.query(
      `CREATE INDEX "idx_wa_contacts_business_number" ON "wa_contacts" ("business_number_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."idx_wa_contacts_business_number"`,
    );
    await queryRunner.query(
      `DELETE FROM "wa_keyword_templates" WHERE "tenant_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."uq_wa_keyword_templates_override"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."idx_wa_keyword_templates_tenant"`,
    );
    await queryRunner.query(
      `ALTER TABLE "wa_keyword_templates" DROP COLUMN "overrides_template_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "wa_keyword_templates" DROP COLUMN "tenant_id"`,
    );
  }
}
