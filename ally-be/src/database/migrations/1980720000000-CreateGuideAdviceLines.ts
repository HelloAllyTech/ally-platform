import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `guide_advice_lines` (plans/ally-guide/plan.md §4.9, Appendix A "Peer"):
 * the advice finishers leave at the finale's mentor door. One per learner
 * per course, at most 200 characters, moderated before it is shown.
 */
export class CreateGuideAdviceLines1980720000000 implements MigrationInterface {
  name = 'CreateGuideAdviceLines1980720000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "guide_advice_lines" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" integer NOT NULL,
        "trackId" uuid NOT NULL,
        "text" character varying(200) NOT NULL,
        "status" character varying(12) NOT NULL DEFAULT 'pending',
        "flags" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "moderatedBy" integer,
        "moderatedAt" timestamp,
        "rejectReason" character varying(200),
        "tenant_id" character varying NOT NULL,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_guide_advice_lines_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_guide_advice_lines_status" CHECK ("status" IN ('pending', 'approved', 'rejected'))
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_guide_advice_lines_user_track" ON "guide_advice_lines" ("userId", "trackId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_guide_advice_lines_track_tenant_status" ON "guide_advice_lines" ("trackId", "tenant_id", "status")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "guide_advice_lines"`);
  }
}
