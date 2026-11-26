import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Contacts: the admin console's minimal shared CRM (`crm_contacts`) and the
 * conversation log kept under each contact (`crm_contact_logs`).
 *
 * Platform-wide, not tenant-scoped: it is the Ally team's own list of who it
 * knows, shared by every admin holding the `crm_contacts` toggle.
 *
 * - `relationship_manager_id` is the one person coordinating with the contact.
 *   `ON DELETE SET NULL`, so removing a user never deletes a contact.
 * - Logs go with their contact (`ON DELETE CASCADE`).
 * - No toggle backfill: the key ships off and is granted person by person.
 */
export class CreateCrmContacts1988500000000 implements MigrationInterface {
  name = 'CreateCrmContacts1988500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "crm_contacts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "full_name" character varying(200) NOT NULL,
        "organization" character varying(200),
        "job_title" character varying(200),
        "notes" text,
        "relationship_manager_id" integer,
        "created_by" integer,
        "updated_by" integer,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_crm_contacts" PRIMARY KEY ("id"),
        CONSTRAINT "FK_crm_contacts_relationship_manager" FOREIGN KEY ("relationship_manager_id")
          REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_crm_contacts_full_name_lower" ON "crm_contacts" (lower("full_name"))`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_crm_contacts_relationship_manager" ON "crm_contacts" ("relationship_manager_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "crm_contact_logs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "contact_id" uuid NOT NULL,
        "occurred_on" date NOT NULL DEFAULT CURRENT_DATE,
        "summary" text NOT NULL,
        "author_id" integer,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_crm_contact_logs" PRIMARY KEY ("id"),
        CONSTRAINT "FK_crm_contact_logs_contact" FOREIGN KEY ("contact_id")
          REFERENCES "crm_contacts"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_crm_contact_logs_author" FOREIGN KEY ("author_id")
          REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_crm_contact_logs_contact_date" ON "crm_contact_logs" ("contact_id", "occurred_on" DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "crm_contact_logs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "crm_contacts"`);
  }
}
