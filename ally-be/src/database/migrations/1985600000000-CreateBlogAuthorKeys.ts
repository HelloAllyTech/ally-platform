import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Keys that let a coding agent (Claude Code) write draft blog posts for the admin who made the
 * key. Only hashes are stored. Mirrors `cl_reader_keys` (Context Library).
 */
export class CreateBlogAuthorKeys1985600000000 implements MigrationInterface {
  name = 'CreateBlogAuthorKeys1985600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "blog_author_keys" (
      "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
      "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "owner_id" integer NOT NULL,
      "label" character varying(80) NOT NULL,
      "key_hash" character varying(64) NOT NULL,
      "key_prefix" character varying(12) NOT NULL,
      "last_used_at" TIMESTAMP,
      "revoked_at" TIMESTAMP,
      CONSTRAINT "PK_blog_author_keys" PRIMARY KEY ("id"))`);
    await queryRunner.query(
      `CREATE INDEX "idx_blog_author_keys_owner" ON "blog_author_keys" ("owner_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_blog_author_keys_hash" ON "blog_author_keys" ("key_hash")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "blog_author_keys"`);
  }
}
