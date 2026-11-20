import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sharing a draft for review, and the author's email on a post.
 * - `blog_review_links`: a revocable, expiring link that lets anyone read a draft.
 * - `blog_review_suggestions`: what reviewers send through it.
 * - `blogs.author_email`: shown with the byline; no backfill (existing posts keep none).
 */
export class BlogReviewLinksAndAuthorEmail1985700000000 implements MigrationInterface {
  name = 'BlogReviewLinksAndAuthorEmail1985700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "blogs" ADD COLUMN "author_email" character varying(255)`,
    );
    await queryRunner.query(`CREATE TABLE "blog_review_links" (
      "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
      "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "blog_id" uuid NOT NULL,
      "token" character varying(64) NOT NULL,
      "expires_at" TIMESTAMP NOT NULL,
      "revoked_at" TIMESTAMP,
      "created_by" integer NOT NULL,
      CONSTRAINT "PK_blog_review_links" PRIMARY KEY ("id"))`);
    await queryRunner.query(
      `CREATE INDEX "idx_blog_review_links_blog" ON "blog_review_links" ("blog_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_blog_review_links_token" ON "blog_review_links" ("token")`,
    );
    await queryRunner.query(`CREATE TABLE "blog_review_suggestions" (
      "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
      "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
      "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
      "blog_id" uuid NOT NULL,
      "link_id" uuid NOT NULL,
      "name" character varying(80) NOT NULL,
      "email" character varying(255),
      "comment" text NOT NULL,
      "quote" text,
      "status" character varying(10) NOT NULL DEFAULT 'OPEN',
      CONSTRAINT "PK_blog_review_suggestions" PRIMARY KEY ("id"))`);
    await queryRunner.query(
      `CREATE INDEX "idx_blog_review_suggestions_blog" ON "blog_review_suggestions" ("blog_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "blog_review_suggestions"`);
    await queryRunner.query(`DROP TABLE "blog_review_links"`);
    await queryRunner.query(`ALTER TABLE "blogs" DROP COLUMN "author_email"`);
  }
}
