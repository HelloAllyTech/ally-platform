import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agents v2, chunk 5a: lists. A bot's lists (Slots, Appointments, Leads…) are rows in these fixed
 * tables, never a table per list. `collections` and `collection_fields` define a list,
 * `collection_constraints` hold its rules (enforced in code inside the write's transaction),
 * `collection_records` hold every entry of every list as jsonb, `record_links` index the relation
 * fields both ways, and `record_events` audit every change.
 *
 * A list key is unique per bot among lists not deleted; field keys follow the same slug rule.
 * `contact_id` mirrors a list's person field; it's set to NULL if the contact row ever goes.
 */
export class AddLists1981900950000 implements MigrationInterface {
  name = 'AddLists1981900950000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "collections" (
         "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
         "chatbot_id" uuid NOT NULL,
         "key" character varying(40) NOT NULL,
         "name" character varying(120) NOT NULL,
         "settings" jsonb NOT NULL DEFAULT '{}',
         "agent_read" boolean NOT NULL DEFAULT false,
         "agent_write" boolean NOT NULL DEFAULT false,
         "deleted_at" TIMESTAMP,
         "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
         "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
         CONSTRAINT "PK_collections" PRIMARY KEY ("id"),
         CONSTRAINT "CHK_collections_key_slug" CHECK ("key" ~ '^[a-z0-9_]{1,40}$'),
         CONSTRAINT "FK_collections_chatbot" FOREIGN KEY ("chatbot_id") REFERENCES "chatbots"("id") ON DELETE CASCADE
       )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_collections_chatbot_key_live" ON "collections" ("chatbot_id", "key") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_collections_chatbot" ON "collections" ("chatbot_id")`,
    );

    await queryRunner.query(
      `CREATE TABLE "collection_fields" (
         "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
         "collection_id" uuid NOT NULL,
         "key" character varying(40) NOT NULL,
         "label" character varying(120) NOT NULL,
         "type" character varying(16) NOT NULL,
         "options" jsonb NOT NULL DEFAULT '{}',
         "required" boolean NOT NULL DEFAULT false,
         "default" jsonb,
         "privacy" jsonb NOT NULL DEFAULT '{}',
         "agent_read" boolean NOT NULL DEFAULT true,
         "agent_write" boolean NOT NULL DEFAULT false,
         "position" integer NOT NULL DEFAULT 0,
         "archived_at" TIMESTAMP,
         "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
         "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
         CONSTRAINT "PK_collection_fields" PRIMARY KEY ("id"),
         CONSTRAINT "UQ_collection_fields_key" UNIQUE ("collection_id", "key"),
         CONSTRAINT "CHK_collection_fields_key_slug" CHECK ("key" ~ '^[a-z0-9_]{1,40}$'),
         CONSTRAINT "CHK_collection_fields_type" CHECK ("type" IN ('text', 'long_text', 'number', 'money', 'date', 'datetime', 'duration', 'select', 'boolean', 'phone', 'email', 'url', 'relation')),
         CONSTRAINT "FK_collection_fields_collection" FOREIGN KEY ("collection_id") REFERENCES "collections"("id") ON DELETE CASCADE
       )`,
    );

    await queryRunner.query(
      `CREATE TABLE "collection_constraints" (
         "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
         "collection_id" uuid NOT NULL,
         "kind" character varying(24) NOT NULL,
         "config" jsonb NOT NULL DEFAULT '{}',
         "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
         "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
         CONSTRAINT "PK_collection_constraints" PRIMARY KEY ("id"),
         CONSTRAINT "CHK_collection_constraints_kind" CHECK ("kind" IN ('unique', 'capacity', 'limit_per_person', 'transitions')),
         CONSTRAINT "FK_collection_constraints_collection" FOREIGN KEY ("collection_id") REFERENCES "collections"("id") ON DELETE CASCADE
       )`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_collection_constraints_collection" ON "collection_constraints" ("collection_id")`,
    );

    await queryRunner.query(
      `CREATE TABLE "collection_records" (
         "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
         "chatbot_id" uuid NOT NULL,
         "collection_id" uuid NOT NULL,
         "data" jsonb NOT NULL DEFAULT '{}',
         "contact_id" uuid,
         "created_by" jsonb NOT NULL DEFAULT '{}',
         "version" integer NOT NULL DEFAULT 1,
         "deleted_at" TIMESTAMP,
         "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
         "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
         CONSTRAINT "PK_collection_records" PRIMARY KEY ("id"),
         CONSTRAINT "FK_collection_records_chatbot" FOREIGN KEY ("chatbot_id") REFERENCES "chatbots"("id") ON DELETE CASCADE,
         CONSTRAINT "FK_collection_records_collection" FOREIGN KEY ("collection_id") REFERENCES "collections"("id") ON DELETE CASCADE,
         CONSTRAINT "FK_collection_records_contact" FOREIGN KEY ("contact_id") REFERENCES "chatbot_contacts"("id") ON DELETE SET NULL
       )`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_collection_records_data" ON "collection_records" USING GIN ("data" jsonb_path_ops)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_collection_records_collection_live" ON "collection_records" ("collection_id") WHERE "deleted_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_collection_records_chatbot" ON "collection_records" ("chatbot_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_collection_records_contact" ON "collection_records" ("contact_id")`,
    );

    await queryRunner.query(
      `CREATE TABLE "record_links" (
         "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
         "record_id" uuid NOT NULL,
         "field_key" character varying(40) NOT NULL,
         "target_kind" character varying(16) NOT NULL,
         "target_id" uuid NOT NULL,
         CONSTRAINT "PK_record_links" PRIMARY KEY ("id"),
         CONSTRAINT "CHK_record_links_target_kind" CHECK ("target_kind" IN ('record', 'contact')),
         CONSTRAINT "FK_record_links_record" FOREIGN KEY ("record_id") REFERENCES "collection_records"("id") ON DELETE CASCADE
       )`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_record_links_record" ON "record_links" ("record_id", "field_key")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_record_links_target" ON "record_links" ("target_kind", "target_id")`,
    );

    await queryRunner.query(
      `CREATE TABLE "record_events" (
         "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
         "record_id" uuid NOT NULL,
         "op" character varying(16) NOT NULL,
         "before" jsonb,
         "after" jsonb,
         "actor" jsonb NOT NULL DEFAULT '{}',
         "run_id" text,
         "created_at" TIMESTAMP NOT NULL DEFAULT now(),
         CONSTRAINT "PK_record_events" PRIMARY KEY ("id"),
         CONSTRAINT "CHK_record_events_op" CHECK ("op" IN ('create', 'update', 'delete', 'restore')),
         CONSTRAINT "FK_record_events_record" FOREIGN KEY ("record_id") REFERENCES "collection_records"("id") ON DELETE CASCADE
       )`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_record_events_record" ON "record_events" ("record_id", "created_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "record_events"`);
    await queryRunner.query(`DROP TABLE "record_links"`);
    await queryRunner.query(`DROP TABLE "collection_records"`);
    await queryRunner.query(`DROP TABLE "collection_constraints"`);
    await queryRunner.query(`DROP TABLE "collection_fields"`);
    await queryRunner.query(`DROP TABLE "collections"`);
  }
}
