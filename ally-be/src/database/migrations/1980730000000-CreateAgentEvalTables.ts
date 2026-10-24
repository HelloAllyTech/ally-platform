import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The harness's learning-loop tables (plans/ally-guide/plan.md §7.13, §8.1),
 * generic across agents like the rest of `agent_*`:
 *
 *  - `agent_eval_suites`, `agent_eval_cases` — replayable cases: saved from
 *    turn traces, proposed from failed turns, written by the weekly red team,
 *    and counterfactual variants of any of those.
 *  - `agent_eval_runs`, `agent_eval_results` — a release replayed against
 *    those cases (smoke for drafts; the gate, three repetitions against GA).
 *  - `agent_evaluations` — the nightly evaluator's verdicts on sampled
 *    production windows. Verdicts only, never learner text.
 *  - `agent_reviews` — the human review queue, whose labels give κ.
 *
 * Additive only. Hand-written SQL with varchar + CHECK constraints; each CHECK
 * is listed in check-constraints-cover-enums.spec.ts.
 */
export class CreateAgentEvalTables1980730000000 implements MigrationInterface {
  name = 'CreateAgentEvalTables1980730000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "agent_eval_suites" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "agentKey" character varying(64) NOT NULL,
        "key" character varying(64) NOT NULL,
        "name" character varying(120) NOT NULL,
        "kind" character varying(16) NOT NULL,
        "description" text,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agent_eval_suites_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_agent_eval_suites_agent_key" UNIQUE ("agentKey", "key"),
        CONSTRAINT "CHK_agent_eval_suites_kind" CHECK ("kind" IN (
          'smoke', 'regression', 'red_team'
        ))
      )`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "agent_eval_cases" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "agentKey" character varying(64) NOT NULL,
        "suiteId" uuid NOT NULL,
        "source" character varying(20) NOT NULL,
        "status" character varying(12) NOT NULL DEFAULT 'active',
        "category" character varying(40) NOT NULL,
        "safety" boolean NOT NULL DEFAULT false,
        "title" character varying(200) NOT NULL,
        "input" jsonb NOT NULL,
        "expectations" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "contentHash" character varying(64) NOT NULL,
        "parentCaseId" uuid,
        "sourceTurnId" uuid,
        "sourceThreadId" uuid,
        "createdBy" integer,
        "notes" text,
        "tenant_id" character varying,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agent_eval_cases_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_agent_eval_cases_agent_hash" UNIQUE ("agentKey", "contentHash"),
        CONSTRAINT "FK_agent_eval_cases_suite" FOREIGN KEY ("suiteId")
          REFERENCES "agent_eval_suites"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_agent_eval_cases_source" CHECK ("source" IN (
          'trace', 'failed_turn', 'review', 'red_team', 'counterfactual', 'manual'
        )),
        CONSTRAINT "CHK_agent_eval_cases_status" CHECK ("status" IN (
          'proposed', 'active', 'retired'
        ))
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_agent_eval_cases_suite_status" ON "agent_eval_cases" ("suiteId", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_agent_eval_cases_source_thread" ON "agent_eval_cases" ("sourceThreadId") WHERE "sourceThreadId" IS NOT NULL`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "agent_eval_runs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "agentKey" character varying(64) NOT NULL,
        "releaseId" uuid NOT NULL,
        "baselineReleaseId" uuid,
        "kind" character varying(12) NOT NULL,
        "status" character varying(12) NOT NULL DEFAULT 'queued',
        "repetitions" integer NOT NULL DEFAULT 1,
        "caseCount" integer NOT NULL DEFAULT 0,
        "summary" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "costUsd" numeric(12,6) NOT NULL DEFAULT 0,
        "triggeredBy" integer,
        "startedAt" TIMESTAMP,
        "completedAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agent_eval_runs_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_agent_eval_runs_release" FOREIGN KEY ("releaseId")
          REFERENCES "agent_releases"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_agent_eval_runs_kind" CHECK ("kind" IN ('smoke', 'gate')),
        CONSTRAINT "CHK_agent_eval_runs_status" CHECK ("status" IN (
          'queued', 'running', 'passed', 'failed', 'error'
        ))
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_agent_eval_runs_release_created" ON "agent_eval_runs" ("releaseId", "createdAt")`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "agent_eval_results" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "runId" uuid NOT NULL,
        "caseId" uuid NOT NULL,
        "releaseId" uuid NOT NULL,
        "repetition" integer NOT NULL DEFAULT 1,
        "passed" boolean NOT NULL,
        "safetyFailed" boolean NOT NULL DEFAULT false,
        "quality" real,
        "checks" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "output" jsonb,
        "error" text,
        "latencyMs" integer,
        "costUsd" numeric(12,6) NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agent_eval_results_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_agent_eval_results_run" FOREIGN KEY ("runId")
          REFERENCES "agent_eval_runs"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_agent_eval_results_case" FOREIGN KEY ("caseId")
          REFERENCES "agent_eval_cases"("id") ON DELETE CASCADE
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_agent_eval_results_run" ON "agent_eval_results" ("runId")`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "agent_evaluations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "agentKey" character varying(64) NOT NULL,
        "turnId" uuid NOT NULL,
        "threadId" uuid NOT NULL,
        "releaseId" uuid,
        "arm" character varying(16),
        "night" date NOT NULL,
        "sample" character varying(12) NOT NULL,
        "status" character varying(12) NOT NULL,
        "flags" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "deterministic" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "critic" jsonb,
        "verifier" jsonb,
        "disagreements" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "safetyFlag" boolean NOT NULL DEFAULT false,
        "costUsd" numeric(12,6) NOT NULL DEFAULT 0,
        "tenant_id" character varying,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agent_evaluations_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_agent_evaluations_turn" UNIQUE ("turnId"),
        CONSTRAINT "CHK_agent_evaluations_sample" CHECK ("sample" IN ('flagged', 'random')),
        CONSTRAINT "CHK_agent_evaluations_status" CHECK ("status" IN (
          'judged', 'checked', 'error'
        ))
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_agent_evaluations_agent_night" ON "agent_evaluations" ("agentKey", "night")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_agent_evaluations_thread" ON "agent_evaluations" ("threadId")`,
    );

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "agent_reviews" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "agentKey" character varying(64) NOT NULL,
        "turnId" uuid NOT NULL,
        "threadId" uuid NOT NULL,
        "evaluationId" uuid,
        "feedbackId" uuid,
        "reason" character varying(16) NOT NULL,
        "status" character varying(12) NOT NULL DEFAULT 'open',
        "priority" smallint NOT NULL DEFAULT 3,
        "reviewerId" integer,
        "claimedAt" TIMESTAMP,
        "completedAt" TIMESTAMP,
        "labels" jsonb,
        "verdict" character varying(12),
        "notes" text,
        "tenant_id" character varying,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agent_reviews_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_agent_reviews_turn_reason" UNIQUE ("turnId", "reason"),
        CONSTRAINT "FK_agent_reviews_evaluation" FOREIGN KEY ("evaluationId")
          REFERENCES "agent_evaluations"("id") ON DELETE SET NULL,
        CONSTRAINT "CHK_agent_reviews_reason" CHECK ("reason" IN (
          'safety_flag', 'disagreement', 'thumbs_down', 'calibration'
        )),
        CONSTRAINT "CHK_agent_reviews_status" CHECK ("status" IN (
          'open', 'claimed', 'done', 'dismissed'
        )),
        CONSTRAINT "CHK_agent_reviews_verdict" CHECK ("verdict" IS NULL OR "verdict" IN ('ok', 'problem'))
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_agent_reviews_status_priority" ON "agent_reviews" ("agentKey", "status", "priority")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_agent_reviews_thread" ON "agent_reviews" ("threadId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "agent_reviews"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "agent_evaluations"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "agent_eval_results"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "agent_eval_runs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "agent_eval_cases"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "agent_eval_suites"`);
  }
}
