import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Retires Analytics -> Suggestions (replaced by the PM Agent, docs/pm-agent.md).
 *
 * The queue is gone, so the table goes with it. Three things need handling first:
 *
 *  1. `ux_signal` rows are the UX Signals scan's improvement findings. That scan now
 *     writes to `pm_agent_signals` (source `ux_signals`), so the existing rows are copied
 *     across before the drop: pending -> new, accepted -> used, rejected -> dismissed,
 *     so a human's earlier rejection still suppresses a re-proposal. The key is
 *     `legacy:<first 16 hex of the id>`, which can never equal a new-style
 *     `<route>#<hash>` key; the new scan therefore may re-file an old title once under
 *     its own key, which is the accepted cost of not re-deriving the old fingerprint in
 *     SQL. `analytics_window` rows (the Generate runs) are NOT copied: they were proposals
 *     for a queue that no longer exists, and accepted ones already live on as roadmap
 *     opportunities.
 *  2. `bug_hunt_events."suggestionId"` has a foreign key onto this table. The column
 *     stays (historical events keep their value); only the constraint is dropped.
 *  3. `1898000000000-CreateBugFindings` already copied the bug-shaped rows into
 *     `bug_findings` (source `analytics_suggestion`), which keep their CHECK value.
 *
 * Stale `analytics_suggestions` rows in `admin_feature_toggles` are removed too; the key
 * no longer exists in code, so nothing could read them.
 *
 * down() recreates the table structure (mirroring 1874000000000 + 1940100000000) and the
 * foreign key, but does not restore data.
 */
export class DropAnalyticsSuggestions1982000000400 implements MigrationInterface {
  name = 'DropAnalyticsSuggestions1982000000400';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "pm_agent_signals"
         ("source", "detector", "key", "title", "summary", "metrics", "severity",
          "status", "firstSeenAt", "lastSeenAt")
       SELECT
         'ux_signals',
         'ux_triage',
         'legacy:' || left(replace(s."id"::text, '-', ''), 16),
         left(s."title", 200),
         left(s."body", 1000),
         jsonb_build_object(
           'legacy', true,
           'body', s."body",
           'rationale', s."rationale",
           'evidence', s."evidence",
           'suggestedGoal', s."suggested_goal",
           'windowFrom', s."window_from",
           'windowTo', s."window_to",
           'windowLabel', s."window_label",
           'model', s."model"
         ),
         NULL,
         CASE s."status"
           WHEN 'accepted' THEN 'used'
           WHEN 'rejected' THEN 'dismissed'
           ELSE 'new'
         END,
         s."createdAt",
         s."createdAt"
       FROM "analytics_suggestions" s
       WHERE s."source" = 'ux_signal'
       ON CONFLICT ("source", "key") DO NOTHING`,
    );

    await queryRunner.query(
      `ALTER TABLE "bug_hunt_events"
       DROP CONSTRAINT IF EXISTS "FK_bug_hunt_events_suggestion_id"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "analytics_suggestions"`);
    await queryRunner.query(
      `DELETE FROM "admin_feature_toggles" WHERE "featureKey" = 'analytics_suggestions'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "analytics_suggestions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "batch_id" uuid NOT NULL,
        "title" text NOT NULL,
        "body" text NOT NULL,
        "rationale" text NOT NULL DEFAULT '',
        "evidence" jsonb NOT NULL DEFAULT '[]',
        "suggested_goal" text,
        "suggested_type" character varying(10) NOT NULL DEFAULT 'idea',
        "status" character varying(10) NOT NULL DEFAULT 'pending',
        "rejected_reason" text,
        "opportunity_id" uuid,
        "window_range" character varying(10),
        "window_from" date NOT NULL,
        "window_to" date NOT NULL,
        "window_label" text NOT NULL,
        "model" text NOT NULL,
        "created_by" integer NOT NULL,
        "updated_by" integer NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "source" character varying(20) NOT NULL DEFAULT 'analytics_window',
        CONSTRAINT "PK_analytics_suggestions_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_analytics_suggestions_status"
          CHECK ("status" IN ('pending', 'accepted', 'rejected')),
        CONSTRAINT "CHK_analytics_suggestions_type"
          CHECK ("suggested_type" IN ('idea', 'bug')),
        CONSTRAINT "CHK_analytics_suggestions_title"
          CHECK (length(btrim("title")) > 0),
        CONSTRAINT "CHK_analytics_suggestions_body"
          CHECK (length(btrim("body")) > 0),
        CONSTRAINT "CHK_analytics_suggestions_source"
          CHECK ("source" IN ('analytics_window', 'ux_signal')),
        CONSTRAINT "FK_analytics_suggestions_opportunity_id"
          FOREIGN KEY ("opportunity_id") REFERENCES "roadmap_opportunities" ("id")
          ON DELETE SET NULL
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_analytics_suggestions_status" ON "analytics_suggestions" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_analytics_suggestions_batch_id" ON "analytics_suggestions" ("batch_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_analytics_suggestions_created_at" ON "analytics_suggestions" ("createdAt" DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_analytics_suggestions_opportunity_id" ON "analytics_suggestions" ("opportunity_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_analytics_suggestions_source_status"
       ON "analytics_suggestions" ("source", "status")
       WHERE "source" = 'ux_signal'`,
    );
    // NOT VALID: historical events may point at rows that were not restored.
    await queryRunner.query(
      `ALTER TABLE "bug_hunt_events"
       ADD CONSTRAINT "FK_bug_hunt_events_suggestion_id"
       FOREIGN KEY ("suggestionId") REFERENCES "analytics_suggestions" ("id")
       ON DELETE SET NULL NOT VALID`,
    );
  }
}
