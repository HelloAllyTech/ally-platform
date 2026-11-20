import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The mental health resources directory (/admin/directory): entries, collections (saved views
 * with a public landing page and optional custom domain) and the join between them.
 *
 * Not tenant-scoped on purpose: public entries are readable by every signed-in user and a
 * collection's landing page is public. Ownership (`owner_id`) is what gates edits.
 * Hand-written, like every recent CREATE here. `down` drops the three tables.
 */
export class CreateDirectory1986100000000 implements MigrationInterface {
  name = 'CreateDirectory1986100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "directory_entries" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "owner_id" integer NOT NULL,
        "title" character varying(200) NOT NULL,
        "description" text NOT NULL DEFAULT '',
        "category" character varying(80) NOT NULL DEFAULT '',
        "organization" character varying(200) NOT NULL DEFAULT '',
        "website_url" character varying(500) NOT NULL DEFAULT '',
        "phone" character varying(60) NOT NULL DEFAULT '',
        "email" character varying(254) NOT NULL DEFAULT '',
        "address" character varying(300) NOT NULL DEFAULT '',
        "city" character varying(100) NOT NULL DEFAULT '',
        "region" character varying(100) NOT NULL DEFAULT '',
        "country" character varying(100) NOT NULL DEFAULT '',
        "tags" jsonb NOT NULL DEFAULT '[]',
        "languages" jsonb NOT NULL DEFAULT '[]',
        "visibility" character varying(16) NOT NULL DEFAULT 'private',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_directory_entries" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_directory_entries_visibility"
          CHECK ("visibility" IN ('public', 'private'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_directory_entries_owner" ON "directory_entries" ("owner_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_directory_entries_visibility" ON "directory_entries" ("visibility")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "directory_collections" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "owner_id" integer NOT NULL,
        "name" character varying(200) NOT NULL,
        "description" text NOT NULL DEFAULT '',
        "slug" character varying(48) NOT NULL,
        "published" boolean NOT NULL DEFAULT false,
        "settings" jsonb NOT NULL DEFAULT '{}',
        "custom_domain" character varying(253),
        "domain_verification_token" character varying(64),
        "domain_verified_at" TIMESTAMP WITH TIME ZONE,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_directory_collections" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_directory_collections_owner" ON "directory_collections" ("owner_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_directory_collections_slug" ON "directory_collections" (lower("slug"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_directory_collections_domain" ON "directory_collections" (lower("custom_domain")) WHERE "custom_domain" IS NOT NULL`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "directory_collection_entries" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "collection_id" uuid NOT NULL,
        "entry_id" uuid NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_directory_collection_entries" PRIMARY KEY ("id"),
        CONSTRAINT "FK_directory_collection_entries_collection" FOREIGN KEY ("collection_id")
          REFERENCES "directory_collections" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_directory_collection_entries_entry" FOREIGN KEY ("entry_id")
          REFERENCES "directory_entries" ("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_directory_collection_entries" ON "directory_collection_entries" ("collection_id", "entry_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_directory_collection_entries_entry" ON "directory_collection_entries" ("entry_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "directory_collection_entries"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "directory_collections"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "directory_entries"`);
  }
}
