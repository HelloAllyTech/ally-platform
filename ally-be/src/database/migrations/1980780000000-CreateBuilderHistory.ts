import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Builder's History: every decision, ask and tell, append-only.
 *
 * ## builder_history
 *
 * One row per thing a person (or a rule) did in the Builder tab — a decision answered from
 * Now, a session page or Slack, an ask, a tell, a start, a put-back. A decision is never
 * stored (it is derived from session state), so this freezes what the card looked like when
 * it was answered: the prompt, the label chosen, and which option was recommended, frozen
 * *before* the answer was applied.
 *
 * Rows are never edited as corrections. `undoneAt` marks a reversible answer taken back inside
 * its undo window; `appliedAt` / `applyError` record when a deferred answer reached the session;
 * `tellStatus` / `appliedRunId` follow a tell from queued to applied.
 *
 * No FK to builder_sessions, like builder_lessons: what was decided outlives the session.
 */
export class CreateBuilderHistory1980780000000 implements MigrationInterface {
  name = 'CreateBuilderHistory1980780000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "builder_history" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "entryType" character varying(8) NOT NULL,
        "decisionId" character varying(200),
        "kind" character varying(24),
        "category" character varying(8),
        "questionType" character varying(24),
        "sessionId" uuid,
        "sessionTitle" character varying(200),
        "pullRequestId" uuid,
        "prompt" text NOT NULL,
        "chosenOptionIds" jsonb,
        "chosenLabel" text,
        "customText" text,
        "answerText" text,
        "recommendedOptionId" character varying(64),
        "matchedRecommendation" boolean,
        "oneWay" boolean NOT NULL DEFAULT false,
        "ruleId" uuid,
        "surface" character varying(12) NOT NULL,
        "client" character varying(8),
        "actorUserId" integer,
        "raisedAt" TIMESTAMP,
        "decidedAt" TIMESTAMP NOT NULL,
        "waitSeconds" integer,
        "msToDecide" integer,
        "undoneAt" TIMESTAMP,
        "appliedAt" TIMESTAMP,
        "applyError" text,
        "tellStatus" character varying(12),
        "appliedRunId" uuid,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_builder_history_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_builder_history_entry_type" CHECK ("entryType" IN ('decision', 'ask', 'tell', 'start', 'putback')),
        CONSTRAINT "CHK_builder_history_surface" CHECK ("surface" IN ('now', 'session', 'slack', 'rule')),
        CONSTRAINT "CHK_builder_history_client" CHECK ("client" IS NULL OR "client" IN ('phone', 'tablet', 'desktop')),
        CONSTRAINT "CHK_builder_history_tell_status" CHECK ("tellStatus" IS NULL OR "tellStatus" IN ('queued', 'applied', 'cancelled')),
        CONSTRAINT "CHK_builder_history_chosen_array" CHECK ("chosenOptionIds" IS NULL OR jsonb_typeof("chosenOptionIds") = 'array')
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_builder_history_session" ON "builder_history" ("sessionId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_builder_history_decided_at" ON "builder_history" ("decidedAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_builder_history_decision" ON "builder_history" ("decisionId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "builder_history"`);
  }
}
