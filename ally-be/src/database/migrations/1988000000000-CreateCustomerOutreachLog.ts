import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * When a member of Ally staff got in touch with a customer organisation, from
 * the Customers tab on Statistics. One row per contact, so the page can say
 * "contacted 3 days ago" and rank an organisation that was just contacted lower.
 * The note is the member of staff's own, short, and never about a learner.
 */
export class CreateCustomerOutreachLog1988000000000 implements MigrationInterface {
  name = 'CreateCustomerOutreachLog1988000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "customer_outreach_log" (` +
        `"id" uuid NOT NULL DEFAULT uuid_generate_v4(), ` +
        `"tenantId" uuid NOT NULL, ` +
        `"userId" integer NOT NULL, ` +
        `"note" character varying(500), ` +
        `"createdAt" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "PK_customer_outreach_log_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_customer_outreach_log_tenant_created" ` +
        `ON "customer_outreach_log" ("tenantId", "createdAt" DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."idx_customer_outreach_log_tenant_created"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "customer_outreach_log"`);
  }
}
