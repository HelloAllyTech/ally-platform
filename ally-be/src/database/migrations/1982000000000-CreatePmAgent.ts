import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * PM Agent (docs/pm-agent.md, plans/ai-product-manager.md §12): twelve tables, the
 * `pm_agent` admin feature toggle backfilled for the platform-tier groups, and the
 * settings singleton seeded OFF.
 *
 * Every enum is a varchar with a CHECK constraint, written out here rather than imported:
 * a migration must keep meaning what it meant when it ran. Uniqueness the state machine
 * relies on is enforced HERE, not only in code:
 *  - `pm_agent_outbox (cardId, action)`: a card can be accepted into a build once;
 *  - `pm_agent_cards.builderSessionId`: one Builder session per card;
 *  - one `running` row in `pm_agent_runs` (partial unique index): the run lock, safe
 *    across ECS tasks;
 *  - `pm_agent_settings.id = 1`: a singleton.
 *
 * Toggle backfill: a new key grants itself to nobody (a missing `admin_feature_toggles`
 * row is false), so PLATFORM_ADMIN / SUPER_ADMIN / SUPER_DUPER_ADMIN members get it ON,
 * as Builder's tier. The agent itself still ships OFF (`enabled = false`). Toggles are
 * cached in Redis (`admin:feature-toggles:v2:*`); admins active at deploy see the tab
 * within the TTL.
 */
const TOGGLE_GROUPS = ['PLATFORM_ADMIN', 'SUPER_ADMIN', 'SUPER_DUPER_ADMIN'];
const TOGGLE_KEY = 'pm_agent';

const CARD_STATUSES = [
  'draft',
  'open',
  'accepted_pending',
  'queued',
  'designing',
  'building',
  'pr_open',
  'merged',
  'released',
  'failed',
  'needs_attention',
  'merged_not_released',
  'handed_off',
  'rejected',
  'feedback_closed',
  'answered',
  'skipped',
  'expired',
  'superseded',
];
const CARD_CATEGORIES = [
  'ui_ux',
  'product',
  'architecture',
  'code_health',
  'infra',
  'cost',
  'strategy_content',
];
const REASON_CHIPS = [
  'not_priority',
  'already_planned',
  'wrong_idea',
  'too_risky',
  'other',
];
const OUTBOX_STEPS = [
  'create_session',
  'file_roadmap',
  'patch_prd',
  'set_repos',
  'start_design',
  'await_design',
  'start_build',
  'done',
];

const inList = (values: string[]) =>
  values.map((value) => `'${value}'`).join(', ');

export class CreatePmAgent1982000000000 implements MigrationInterface {
  name = 'CreatePmAgent1982000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "pm_agent_settings" (
        "id" integer NOT NULL DEFAULT 1,
        "enabled" boolean NOT NULL DEFAULT false,
        "monthlyBudgetUsd" numeric(10,2) NOT NULL DEFAULT 100,
        "queueCap" integer NOT NULL DEFAULT 5,
        "runHourIst" integer NOT NULL DEFAULT 9,
        "mandate" text NOT NULL DEFAULT '',
        "pauseAutoBuild" boolean NOT NULL DEFAULT false,
        "slackNotify" boolean NOT NULL DEFAULT false,
        "categoryWeights" jsonb NULL,
        "autoBuildPaused" boolean NOT NULL DEFAULT false,
        "autoBuildPausedReason" varchar(300) NULL,
        "autoBuildPausedAt" timestamptz NULL,
        "consecutiveBuildFailures" integer NOT NULL DEFAULT 0,
        "updatedBy" integer NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_pm_agent_settings" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_pm_agent_settings_singleton" CHECK ("id" = 1),
        CONSTRAINT "CHK_pm_agent_settings_queue_cap" CHECK ("queueCap" BETWEEN 1 AND 10),
        CONSTRAINT "CHK_pm_agent_settings_run_hour" CHECK ("runHourIst" BETWEEN 0 AND 23),
        CONSTRAINT "CHK_pm_agent_settings_budget" CHECK ("monthlyBudgetUsd" >= 0)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "pm_agent_runs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "status" varchar(16) NOT NULL DEFAULT 'running',
        "trigger" varchar(16) NOT NULL,
        "runDate" date NOT NULL,
        "stopReason" varchar(40) NULL,
        "startedAt" timestamptz NOT NULL DEFAULT now(),
        "finishedAt" timestamptz NULL,
        "reservedUsd" numeric(10,4) NOT NULL DEFAULT 0,
        "spentUsd" numeric(10,4) NOT NULL DEFAULT 0,
        "cardsCreated" integer NOT NULL DEFAULT 0,
        "lanes" jsonb NULL,
        "error" text NULL,
        "triggeredBy" integer NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_pm_agent_runs" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_pm_agent_runs_status" CHECK ("status" IN ('running', 'completed', 'failed', 'skipped')),
        CONSTRAINT "CHK_pm_agent_runs_trigger" CHECK ("trigger" IN ('scheduled', 'manual', 'revision'))
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_pm_agent_runs_one_running" ON "pm_agent_runs" ((true)) WHERE "status" = 'running'`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_pm_agent_runs_started" ON "pm_agent_runs" ("startedAt")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "pm_agent_run_steps" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "runId" uuid NOT NULL,
        "lane" varchar(32) NOT NULL,
        "kind" varchar(16) NOT NULL,
        "promptCode" varchar(80) NULL,
        "promptVersion" integer NULL,
        "model" varchar(80) NULL,
        "tokensIn" integer NOT NULL DEFAULT 0,
        "tokensOut" integer NOT NULL DEFAULT 0,
        "costUsd" numeric(10,4) NOT NULL DEFAULT 0,
        "reservedUsd" numeric(10,4) NOT NULL DEFAULT 0,
        "toolCalls" jsonb NULL,
        "latencyMs" integer NULL,
        "outcome" varchar(16) NOT NULL,
        "detail" jsonb NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_pm_agent_run_steps" PRIMARY KEY ("id"),
        CONSTRAINT "FK_pm_agent_run_steps_run" FOREIGN KEY ("runId")
          REFERENCES "pm_agent_runs"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_pm_agent_run_steps_kind" CHECK ("kind" IN ('lane', 'critic', 'ranker', 'gate', 'tool')),
        CONSTRAINT "CHK_pm_agent_run_steps_outcome" CHECK ("outcome" IN ('ok', 'discarded', 'failed', 'skipped', 'budget'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_pm_agent_run_steps_run" ON "pm_agent_run_steps" ("runId")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "pm_agent_evidence" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "runId" uuid NOT NULL,
        "source" varchar(32) NOT NULL,
        "kind" varchar(32) NOT NULL,
        "label" varchar(200) NOT NULL,
        "query" jsonb NULL,
        "snapshot" jsonb NULL,
        "url" text NULL,
        "fetchedAt" timestamptz NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_pm_agent_evidence" PRIMARY KEY ("id"),
        CONSTRAINT "FK_pm_agent_evidence_run" FOREIGN KEY ("runId")
          REFERENCES "pm_agent_runs"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_pm_agent_evidence_run" ON "pm_agent_evidence" ("runId")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "pm_agent_cards" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "runId" uuid NULL,
        "kind" varchar(16) NOT NULL,
        "category" varchar(24) NOT NULL,
        "status" varchar(24) NOT NULL DEFAULT 'open',
        "version" integer NOT NULL DEFAULT 1,
        "versionHash" varchar(64) NOT NULL,
        "title" varchar(200) NOT NULL,
        "payload" jsonb NOT NULL,
        "rank" double precision NOT NULL DEFAULT 0,
        "evidenceFreshness" timestamptz NULL,
        "questionKey" varchar(160) NULL,
        "revisedFromCardId" uuid NULL,
        "openedAt" timestamptz NULL,
        "decidedAt" timestamptz NULL,
        "decidedBy" integer NULL,
        "acceptPath" varchar(16) NULL,
        "undoUntil" timestamptz NULL,
        "reasonChip" varchar(24) NULL,
        "reason" text NULL,
        "needsYouReason" text NULL,
        "needsYouDismissedAt" timestamptz NULL,
        "suppressUntil" timestamptz NULL,
        "compiledPrd" jsonb NULL,
        "compiledPrdHash" varchar(64) NULL,
        "builderSessionId" uuid NULL,
        "roadmapOpportunityId" uuid NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_pm_agent_cards" PRIMARY KEY ("id"),
        CONSTRAINT "FK_pm_agent_cards_run" FOREIGN KEY ("runId")
          REFERENCES "pm_agent_runs"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_pm_agent_cards_revised_from" FOREIGN KEY ("revisedFromCardId")
          REFERENCES "pm_agent_cards"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_pm_agent_cards_builder_session" FOREIGN KEY ("builderSessionId")
          REFERENCES "builder_sessions"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_pm_agent_cards_opportunity" FOREIGN KEY ("roadmapOpportunityId")
          REFERENCES "roadmap_opportunities"("id") ON DELETE SET NULL,
        CONSTRAINT "CHK_pm_agent_cards_kind" CHECK ("kind" IN ('recommendation', 'question')),
        CONSTRAINT "CHK_pm_agent_cards_category" CHECK ("category" IN (${inList(CARD_CATEGORIES)})),
        CONSTRAINT "CHK_pm_agent_cards_status" CHECK ("status" IN (${inList(CARD_STATUSES)})),
        CONSTRAINT "CHK_pm_agent_cards_accept_path" CHECK ("acceptPath" IS NULL OR "acceptPath" IN ('builder', 'download')),
        CONSTRAINT "CHK_pm_agent_cards_reason_chip" CHECK ("reasonChip" IS NULL OR "reasonChip" IN (${inList(REASON_CHIPS)}))
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_pm_agent_cards_builder_session" ON "pm_agent_cards" ("builderSessionId") WHERE "builderSessionId" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_pm_agent_cards_status" ON "pm_agent_cards" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_pm_agent_cards_run" ON "pm_agent_cards" ("runId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_pm_agent_cards_hash" ON "pm_agent_cards" ("versionHash")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_pm_agent_cards_question_key" ON "pm_agent_cards" ("questionKey") WHERE "questionKey" IS NOT NULL`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "pm_agent_card_events" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "cardId" uuid NOT NULL,
        "type" varchar(40) NOT NULL,
        "fromStatus" varchar(24) NULL,
        "toStatus" varchar(24) NULL,
        "cardVersion" integer NOT NULL,
        "actorUserId" integer NULL,
        "detail" jsonb NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_pm_agent_card_events" PRIMARY KEY ("id"),
        CONSTRAINT "FK_pm_agent_card_events_card" FOREIGN KEY ("cardId")
          REFERENCES "pm_agent_cards"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_pm_agent_card_events_card" ON "pm_agent_card_events" ("cardId", "createdAt")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "pm_agent_memory" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "kind" varchar(16) NOT NULL DEFAULT 'fact',
        "key" varchar(160) NOT NULL,
        "value" text NOT NULL,
        "scope" varchar(16) NOT NULL DEFAULT 'global',
        "source" varchar(16) NOT NULL,
        "sourceCardId" uuid NULL,
        "confidence" numeric(4,3) NULL,
        "active" boolean NOT NULL DEFAULT true,
        "expiresAt" timestamptz NULL,
        "supersedesId" uuid NULL,
        "createdBy" integer NULL,
        "updatedBy" integer NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_pm_agent_memory" PRIMARY KEY ("id"),
        CONSTRAINT "FK_pm_agent_memory_card" FOREIGN KEY ("sourceCardId")
          REFERENCES "pm_agent_cards"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_pm_agent_memory_supersedes" FOREIGN KEY ("supersedesId")
          REFERENCES "pm_agent_memory"("id") ON DELETE SET NULL,
        CONSTRAINT "CHK_pm_agent_memory_kind" CHECK ("kind" IN ('fact', 'lesson')),
        CONSTRAINT "CHK_pm_agent_memory_scope" CHECK ("scope" IN ('global', 'feature', 'tenant')),
        CONSTRAINT "CHK_pm_agent_memory_source" CHECK ("source" IN ('card', 'answer', 'rejection', 'feedback', 'manual'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_pm_agent_memory_active" ON "pm_agent_memory" ("kind", "active")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_pm_agent_memory_key" ON "pm_agent_memory" ("key")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "pm_agent_feedback" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "cardId" uuid NOT NULL,
        "text" text NOT NULL,
        "chips" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "reviseNow" boolean NOT NULL DEFAULT false,
        "status" varchar(16) NOT NULL DEFAULT 'pending',
        "successorCardId" uuid NULL,
        "createdBy" integer NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_pm_agent_feedback" PRIMARY KEY ("id"),
        CONSTRAINT "FK_pm_agent_feedback_card" FOREIGN KEY ("cardId")
          REFERENCES "pm_agent_cards"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_pm_agent_feedback_successor" FOREIGN KEY ("successorCardId")
          REFERENCES "pm_agent_cards"("id") ON DELETE SET NULL,
        CONSTRAINT "CHK_pm_agent_feedback_status" CHECK ("status" IN ('pending', 'in_progress', 'done', 'cancelled'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_pm_agent_feedback_status" ON "pm_agent_feedback" ("status")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "pm_agent_outbox" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "cardId" uuid NOT NULL,
        "action" varchar(16) NOT NULL DEFAULT 'build',
        "status" varchar(16) NOT NULL DEFAULT 'pending',
        "step" varchar(24) NOT NULL DEFAULT 'create_session',
        "dueAt" timestamptz NOT NULL,
        "attempts" integer NOT NULL DEFAULT 0,
        "lastError" text NULL,
        "lockedUntil" timestamptz NULL,
        "createdBy" integer NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_pm_agent_outbox" PRIMARY KEY ("id"),
        CONSTRAINT "FK_pm_agent_outbox_card" FOREIGN KEY ("cardId")
          REFERENCES "pm_agent_cards"("id") ON DELETE CASCADE,
        CONSTRAINT "UQ_pm_agent_outbox_card_action" UNIQUE ("cardId", "action"),
        CONSTRAINT "CHK_pm_agent_outbox_action" CHECK ("action" IN ('build')),
        CONSTRAINT "CHK_pm_agent_outbox_status" CHECK ("status" IN ('pending', 'running', 'waiting', 'done', 'failed', 'cancelled')),
        CONSTRAINT "CHK_pm_agent_outbox_step" CHECK ("step" IN (${inList(OUTBOX_STEPS)}))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_pm_agent_outbox_due" ON "pm_agent_outbox" ("status", "dueAt")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "pm_agent_signals" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "source" varchar(32) NOT NULL DEFAULT 'ux_signals',
        "detector" varchar(80) NOT NULL,
        "key" varchar(160) NOT NULL,
        "title" varchar(200) NOT NULL,
        "summary" text NOT NULL DEFAULT '',
        "metrics" jsonb NULL,
        "severity" varchar(16) NULL,
        "status" varchar(16) NOT NULL DEFAULT 'new',
        "firstSeenAt" timestamptz NOT NULL DEFAULT now(),
        "lastSeenAt" timestamptz NOT NULL DEFAULT now(),
        "cardId" uuid NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_pm_agent_signals" PRIMARY KEY ("id"),
        CONSTRAINT "FK_pm_agent_signals_card" FOREIGN KEY ("cardId")
          REFERENCES "pm_agent_cards"("id") ON DELETE SET NULL,
        CONSTRAINT "UQ_pm_agent_signals_source_key" UNIQUE ("source", "key"),
        CONSTRAINT "CHK_pm_agent_signals_status" CHECK ("status" IN ('new', 'used', 'dismissed'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_pm_agent_signals_status" ON "pm_agent_signals" ("status")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "pm_agent_outcomes" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "cardId" uuid NOT NULL,
        "decision" varchar(16) NOT NULL,
        "decidedBy" integer NULL,
        "decidedAt" timestamptz NOT NULL,
        "decisionLatencyMs" integer NULL,
        "reasonChip" varchar(24) NULL,
        "feedbackChips" jsonb NULL,
        "undone" boolean NOT NULL DEFAULT false,
        "buildStarted" boolean NOT NULL DEFAULT false,
        "buildFailed" boolean NOT NULL DEFAULT false,
        "prOpened" boolean NOT NULL DEFAULT false,
        "merged" boolean NOT NULL DEFAULT false,
        "released" boolean NOT NULL DEFAULT false,
        "reverted" boolean NOT NULL DEFAULT false,
        "healthCheckFailed" boolean NOT NULL DEFAULT false,
        "impactMetricName" varchar(120) NULL,
        "baselineValue" double precision NULL,
        "value14d" double precision NULL,
        "value30d" double precision NULL,
        "buildCostUsd" numeric(10,4) NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_pm_agent_outcomes" PRIMARY KEY ("id"),
        CONSTRAINT "FK_pm_agent_outcomes_card" FOREIGN KEY ("cardId")
          REFERENCES "pm_agent_cards"("id") ON DELETE CASCADE,
        CONSTRAINT "UQ_pm_agent_outcomes_card" UNIQUE ("cardId"),
        CONSTRAINT "CHK_pm_agent_outcomes_decision" CHECK ("decision" IN ('accepted', 'handed_off', 'rejected', 'feedback', 'answered', 'skipped'))
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "pm_agent_lane_stats" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "dimension" varchar(16) NOT NULL,
        "key" varchar(64) NOT NULL,
        "shown" integer NOT NULL DEFAULT 0,
        "accepted" integer NOT NULL DEFAULT 0,
        "rejected" integer NOT NULL DEFAULT 0,
        "feedback" integer NOT NULL DEFAULT 0,
        "shipped" integer NOT NULL DEFAULT 0,
        "failed" integer NOT NULL DEFAULT 0,
        "decayedScore" double precision NULL,
        "costUsd" numeric(10,4) NOT NULL DEFAULT 0,
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_pm_agent_lane_stats" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_pm_agent_lane_stats_dimension_key" UNIQUE ("dimension", "key"),
        CONSTRAINT "CHK_pm_agent_lane_stats_dimension" CHECK ("dimension" IN ('category', 'lane', 'source'))
      )
    `);

    // The singleton, OFF. An existing row (a re-run) is left alone.
    await queryRunner.query(
      `INSERT INTO "pm_agent_settings" ("id", "enabled", "monthlyBudgetUsd", "queueCap", "runHourIst", "pauseAutoBuild")
       VALUES (1, false, 100, 5, 9, false)
       ON CONFLICT ("id") DO NOTHING`,
    );

    await queryRunner.query(
      `
      INSERT INTO "admin_feature_toggles" ("userId", "featureKey", "enabled")
      SELECT DISTINCT ug."userId", $2::character varying, true
      FROM "user_groups" ug
      JOIN "groups" g ON g.id = ug."groupId" AND g.name = ANY($1::character varying[])
      ON CONFLICT ("userId", "featureKey") DO NOTHING
      `,
      [TOGGLE_GROUPS, TOGGLE_KEY],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "admin_feature_toggles" WHERE "featureKey" = $1::character varying`,
      [TOGGLE_KEY],
    );
    for (const table of [
      'pm_agent_lane_stats',
      'pm_agent_outcomes',
      'pm_agent_signals',
      'pm_agent_outbox',
      'pm_agent_feedback',
      'pm_agent_memory',
      'pm_agent_card_events',
      'pm_agent_cards',
      'pm_agent_evidence',
      'pm_agent_run_steps',
      'pm_agent_runs',
      'pm_agent_settings',
    ]) {
      await queryRunner.query(`DROP TABLE IF EXISTS "${table}"`);
    }
  }
}
