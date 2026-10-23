import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `guide_outreach` (plans/ally-guide/plan.md §4.8, Appendix A "Outreach"):
 * every reminder Ally sent — at the time a learner chose, or one nudge per
 * idle stretch — and every appointment it did not send, with why. The
 * frequency rules (one per 7 days, three per course) are counted from here.
 */
export class CreateGuideOutreach1980680000000 implements MigrationInterface {
  name = 'CreateGuideOutreach1980680000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "guide_outreach" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "threadId" uuid NOT NULL,
        "userId" integer NOT NULL,
        "trackId" uuid NOT NULL,
        "kind" character varying(16) NOT NULL,
        "appointmentId" uuid,
        "status" character varying(16) NOT NULL,
        "reason" character varying(64),
        "channels" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "title" character varying(120),
        "body" character varying(500),
        "writer" character varying(16),
        "tenant_id" character varying,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_guide_outreach_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_guide_outreach_kind" CHECK ("kind" IN ('appointment', 'idle')),
        CONSTRAINT "CHK_guide_outreach_status" CHECK ("status" IN ('sent', 'skipped', 'failed'))
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_guide_outreach_user_created" ON "guide_outreach" ("userId", "createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_guide_outreach_thread" ON "guide_outreach" ("threadId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "guide_outreach"`);
  }
}
