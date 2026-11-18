import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Expert review of Debrief agent debriefs (debrief orchestrator spec, Part B):
 * a verdict per run and reviewer, and comments pinned to a transcript turn, a
 * card or the whole debrief. Comments are the PM agent's main signal; learners
 * never see them.
 *
 * Hand-written SQL, never `migration:generate`. Every CHECK lists an enum in
 * `src/debrief/enum/debrief-review.enum.ts` (check-constraints-cover-enums.spec.ts).
 */
export class CreateDebriefExpertReview1981900700000 implements MigrationInterface {
  name = 'CreateDebriefExpertReview1981900700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "debrief_reviews" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "tenant_id" character varying,
        "runId" uuid NOT NULL,
        "reviewerId" integer NOT NULL,
        "verdict" character varying(12) NOT NULL,
        "hardFails" jsonb NOT NULL DEFAULT '[]'::jsonb,
        CONSTRAINT "PK_debrief_reviews" PRIMARY KEY ("id"),
        CONSTRAINT "FK_debrief_reviews_run" FOREIGN KEY ("runId")
          REFERENCES "debrief_runs"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_debrief_reviews_verdict" CHECK ("verdict" IN ('good','needs_work'))
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "debrief_reviews_run_reviewer_uq"
        ON "debrief_reviews" ("runId", "reviewerId")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "debrief_review_comments" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "tenant_id" character varying,
        "runId" uuid NOT NULL,
        "reviewerId" integer NOT NULL,
        "parentId" uuid,
        "anchorKind" character varying(12) NOT NULL,
        "turnIndex" integer,
        "section" character varying(64),
        "spanStart" integer,
        "spanEnd" integer,
        "quotedText" text,
        "body" text NOT NULL,
        "tag" character varying(24),
        "status" character varying(10) NOT NULL DEFAULT 'open',
        "resolvedBy" integer,
        "resolvedAt" TIMESTAMP,
        "ideaId" uuid,
        "repeatOfId" uuid,
        CONSTRAINT "PK_debrief_review_comments" PRIMARY KEY ("id"),
        CONSTRAINT "FK_debrief_review_comments_run" FOREIGN KEY ("runId")
          REFERENCES "debrief_runs"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_debrief_review_comments_parent" FOREIGN KEY ("parentId")
          REFERENCES "debrief_review_comments"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_debrief_review_comments_repeat_of" FOREIGN KEY ("repeatOfId")
          REFERENCES "debrief_review_comments"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_debrief_review_comments_idea" FOREIGN KEY ("ideaId")
          REFERENCES "agent_lessons"("id") ON DELETE SET NULL,
        CONSTRAINT "CHK_debrief_review_comments_anchor_kind"
          CHECK ("anchorKind" IN ('transcript','card','debrief')),
        CONSTRAINT "CHK_debrief_review_comments_tag" CHECK ("tag" IS NULL OR "tag" IN (
          'missed_moment','wrong_or_unsupported','tone','advice_doesnt_fit',
          'protocol','language','too_long_or_unclear','good_keep_this')),
        CONSTRAINT "CHK_debrief_review_comments_status" CHECK ("status" IN ('open','resolved')),
        CONSTRAINT "CHK_debrief_review_comments_span" CHECK (
          ("spanStart" IS NULL AND "spanEnd" IS NULL)
          OR ("spanStart" >= 0 AND "spanEnd" > "spanStart"))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "debrief_review_comments_run_idx"
        ON "debrief_review_comments" ("runId", "createdAt")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "debrief_review_comments_created_idx"
        ON "debrief_review_comments" ("createdAt")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "debrief_review_comments_reviewer_idx"
        ON "debrief_review_comments" ("reviewerId", "createdAt")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "debrief_review_comments"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "debrief_reviews"`);
  }
}
