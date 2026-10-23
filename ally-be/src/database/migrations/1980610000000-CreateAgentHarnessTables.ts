import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The reusable agent harness (plans/ally-guide/plan.md §7, §8.1). Generic
 * across agents — every row carries `agentKey` — so Course Copilot or Builder
 * can move onto the harness later without a schema change. The Ally guide is
 * the first agent (`agentKey = 'ally_guide'`).
 *
 *  - `agent_releases` — immutable, versioned bundles of everything that
 *    decides an agent's behaviour (prompts, model routing, capabilities,
 *    policy values, playbook). Exactly one GA release per agent, enforced by a
 *    partial unique index.
 *  - `agent_release_audit` — append-only history of every release action.
 *  - `agent_config_overrides` — org- and course-layer policy overrides,
 *    resolved over the release defaults (plan §7.5).
 *  - `agent_turns` — the turn state machine; `clientTurnId` makes a turn
 *    request idempotent per thread.
 *  - `agent_turn_traces` — the product-level trace of each turn (summary
 *    here, the full payload in S3 under `payloadKey`).
 *  - `agent_cost_ledger` — per-call cost lines, summed for budgets.
 *
 * Learning-loop tables (lessons, evals, reviews) are deliberately NOT created
 * here: they arrive with milestone M4, so nothing ships ahead of its use.
 *
 * Hand-written SQL with varchar + CHECK constraints (the Builder and Course
 * Copilot precedent). Every CHECK is listed in check-constraints-cover-enums
 * .spec.ts against the enum it guards. `tenant_id` is character varying like
 * BaseEntity's, and nullable: anonymous guide visitors have no tenant yet.
 */
export class CreateAgentHarnessTables1980610000000 implements MigrationInterface {
  name = 'CreateAgentHarnessTables1980610000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "agent_releases" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "agentKey" character varying(64) NOT NULL,
        "version" integer NOT NULL,
        "status" character varying(16) NOT NULL DEFAULT 'draft',
        "bundle" jsonb NOT NULL,
        "contentHash" character varying(64) NOT NULL,
        "parentReleaseId" uuid,
        "rolloutPercent" integer,
        "authorKind" character varying(16) NOT NULL,
        "createdBy" integer,
        "notes" text,
        "evalRunId" uuid,
        "shadowReportId" uuid,
        "promotedAt" TIMESTAMP,
        "retiredAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agent_releases_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_agent_releases_agent_version" UNIQUE ("agentKey", "version"),
        CONSTRAINT "CHK_agent_releases_status" CHECK ("status" IN (
          'draft', 'evaluating', 'candidate', 'shadow', 'canary', 'ga', 'retired'
        )),
        CONSTRAINT "CHK_agent_releases_author_kind" CHECK ("authorKind" IN (
          'seed', 'human', 'curator'
        )),
        CONSTRAINT "CHK_agent_releases_rollout_percent" CHECK (
          "rolloutPercent" IS NULL OR ("rolloutPercent" >= 0 AND "rolloutPercent" <= 100)
        )
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_agent_releases_one_ga" ON "agent_releases" ("agentKey") WHERE "status" = 'ga'`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_agent_releases_agent_status" ON "agent_releases" ("agentKey", "status")`,
    );

    await queryRunner.query(
      `CREATE TABLE "agent_release_audit" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "agentKey" character varying(64) NOT NULL,
        "releaseId" uuid NOT NULL,
        "action" character varying(32) NOT NULL,
        "actorUserId" integer,
        "actorKind" character varying(16) NOT NULL,
        "detail" jsonb,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agent_release_audit_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_agent_release_audit_release" FOREIGN KEY ("releaseId")
          REFERENCES "agent_releases"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_agent_release_audit_action" CHECK ("action" IN (
          'created', 'status_changed', 'promoted', 'rolled_back',
          'emergency_rollback', 'note'
        )),
        CONSTRAINT "CHK_agent_release_audit_actor_kind" CHECK ("actorKind" IN (
          'seed', 'human', 'curator'
        ))
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_agent_release_audit_agent_created" ON "agent_release_audit" ("agentKey", "createdAt")`,
    );

    await queryRunner.query(
      `CREATE TABLE "agent_config_overrides" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "agentKey" character varying(64) NOT NULL,
        "layer" character varying(16) NOT NULL,
        "scopeId" character varying(64) NOT NULL,
        "values" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "version" integer NOT NULL DEFAULT 1,
        "updatedBy" integer,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agent_config_overrides_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_agent_config_overrides_scope" UNIQUE ("agentKey", "layer", "scopeId"),
        CONSTRAINT "CHK_agent_config_overrides_layer" CHECK ("layer" IN ('org', 'course'))
      )`,
    );

    await queryRunner.query(
      `CREATE TABLE "agent_turns" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "agentKey" character varying(64) NOT NULL,
        "threadId" uuid NOT NULL,
        "clientTurnId" character varying(64),
        "trigger" character varying(24) NOT NULL,
        "channel" character varying(8) NOT NULL DEFAULT 'text',
        "status" character varying(16) NOT NULL DEFAULT 'received',
        "releaseId" uuid,
        "arm" character varying(16),
        "errorCode" character varying(32),
        "startedAt" TIMESTAMP,
        "completedAt" TIMESTAMP,
        "ttftMs" integer,
        "durationMs" integer,
        "costUsd" numeric(12,6) NOT NULL DEFAULT 0,
        "tenant_id" character varying,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agent_turns_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_agent_turns_status" CHECK ("status" IN (
          'received', 'admitted', 'streaming', 'tool_wait', 'completed',
          'failed', 'cancelled', 'interrupted'
        )),
        CONSTRAINT "CHK_agent_turns_trigger" CHECK ("trigger" IN (
          'learner_message', 'card_event', 'platform_event', 'resume', 'intent'
        )),
        CONSTRAINT "CHK_agent_turns_channel" CHECK ("channel" IN ('text', 'voice', 'event'))
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_agent_turns_client_turn" ON "agent_turns" ("threadId", "clientTurnId") WHERE "clientTurnId" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_agent_turns_thread_created" ON "agent_turns" ("threadId", "createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_agent_turns_open" ON "agent_turns" ("status") WHERE "status" IN ('received', 'admitted', 'streaming', 'tool_wait')`,
    );

    await queryRunner.query(
      `CREATE TABLE "agent_turn_traces" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "turnId" uuid NOT NULL,
        "agentKey" character varying(64) NOT NULL,
        "threadId" uuid NOT NULL,
        "releaseId" uuid,
        "summary" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "payloadKey" character varying(512),
        "tenant_id" character varying,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agent_turn_traces_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_agent_turn_traces_turn" UNIQUE ("turnId"),
        CONSTRAINT "FK_agent_turn_traces_turn" FOREIGN KEY ("turnId")
          REFERENCES "agent_turns"("id") ON DELETE CASCADE
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_agent_turn_traces_thread_created" ON "agent_turn_traces" ("threadId", "createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_agent_turn_traces_created" ON "agent_turn_traces" ("createdAt")`,
    );

    await queryRunner.query(
      `CREATE TABLE "agent_cost_ledger" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "agentKey" character varying(64) NOT NULL,
        "threadId" uuid,
        "turnId" uuid,
        "userId" integer,
        "visitorId" uuid,
        "role" character varying(32) NOT NULL,
        "provider" character varying(32) NOT NULL,
        "model" character varying(128) NOT NULL,
        "promptTokens" integer NOT NULL DEFAULT 0,
        "completionTokens" integer NOT NULL DEFAULT 0,
        "cacheReadTokens" integer NOT NULL DEFAULT 0,
        "cacheCreationTokens" integer NOT NULL DEFAULT 0,
        "usd" numeric(12,6) NOT NULL DEFAULT 0,
        "tenant_id" character varying,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agent_cost_ledger_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_agent_cost_ledger_thread" ON "agent_cost_ledger" ("threadId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_agent_cost_ledger_user_created" ON "agent_cost_ledger" ("userId", "createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_agent_cost_ledger_visitor_created" ON "agent_cost_ledger" ("visitorId", "createdAt") WHERE "visitorId" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_agent_cost_ledger_agent_created" ON "agent_cost_ledger" ("agentKey", "createdAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "agent_cost_ledger"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "agent_turn_traces"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "agent_turns"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "agent_config_overrides"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "agent_release_audit"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "agent_releases"`);
  }
}
