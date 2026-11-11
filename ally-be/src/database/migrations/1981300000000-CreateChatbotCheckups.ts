import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agents v2, chunk 20a-2: the Checkup. Test questions per assistant (each with a real source),
 * runs of them through the assistant's own engine, and one graded result per question per run.
 * Keyed by chatbot, so the Checkup, the eval suites and the scorecard (Q2a) read one store.
 *
 * Safety questions come from the platform per pack and are never deleted by a regenerate; nor are
 * questions the owner added or confirmed.
 */
export class CreateChatbotCheckups1981300000000 implements MigrationInterface {
  name = 'CreateChatbotCheckups1981300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "chatbot_checkup_cases" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "chatbot_id" uuid NOT NULL, "question" character varying(500) NOT NULL, "expect" character varying(16) NOT NULL, "facts" jsonb NOT NULL DEFAULT '[]', "must_not" jsonb NOT NULL DEFAULT '[]', "also_ok" jsonb NOT NULL DEFAULT '[]', "source" jsonb NOT NULL DEFAULT '{}', "origin" character varying(16) NOT NULL, "confirmed" boolean NOT NULL DEFAULT false, "status" character varying(16) NOT NULL DEFAULT 'active', "hard_fail" boolean NOT NULL DEFAULT false, "tier" character varying(16) NOT NULL DEFAULT 'must_pass', "thread" character varying(64), "position" integer NOT NULL DEFAULT 0, "suite" character varying(64), "external_id" character varying(64), "pack_id" character varying(32), "pack_version" integer, "generation" integer NOT NULL DEFAULT 0, "created_by" integer, CONSTRAINT "PK_chatbot_checkup_cases_id" PRIMARY KEY ("id"), CONSTRAINT "CHK_chatbot_checkup_cases_expect" CHECK ("expect" IN ('answer', 'decline', 'clarify', 'crisis_only', 'smalltalk')), CONSTRAINT "CHK_chatbot_checkup_cases_origin" CHECK ("origin" IN ('generated', 'owner', 'platform', 'suite')), CONSTRAINT "CHK_chatbot_checkup_cases_status" CHECK ("status" IN ('active', 'paused')), CONSTRAINT "FK_chatbot_checkup_cases_chatbot" FOREIGN KEY ("chatbot_id") REFERENCES "chatbots"("id") ON DELETE CASCADE)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_chatbot_checkup_cases_chatbot" ON "chatbot_checkup_cases" ("chatbot_id", "status", "position")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_chatbot_checkup_cases_suite" ON "chatbot_checkup_cases" ("chatbot_id", "suite", "external_id") WHERE "suite" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "chatbot_checkup_runs" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "chatbot_id" uuid NOT NULL, "draft_id" uuid, "trigger" character varying(16) NOT NULL, "suite" character varying(64), "status" character varying(16) NOT NULL DEFAULT 'running', "total" integer NOT NULL DEFAULT 0, "done" integer NOT NULL DEFAULT 0, "totals" jsonb NOT NULL DEFAULT '{}', "started_by" integer, "started_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "finished_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_chatbot_checkup_runs_id" PRIMARY KEY ("id"), CONSTRAINT "CHK_chatbot_checkup_runs_trigger" CHECK ("trigger" IN ('onboarding', 'manual', 'after_change', 'eval')), CONSTRAINT "CHK_chatbot_checkup_runs_status" CHECK ("status" IN ('running', 'done', 'failed')), CONSTRAINT "FK_chatbot_checkup_runs_chatbot" FOREIGN KEY ("chatbot_id") REFERENCES "chatbots"("id") ON DELETE CASCADE)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_chatbot_checkup_runs_chatbot" ON "chatbot_checkup_runs" ("chatbot_id", "started_at")`,
    );
    await queryRunner.query(
      `CREATE TABLE "chatbot_checkup_results" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "run_id" uuid NOT NULL, "case_id" uuid NOT NULL, "attempt" integer NOT NULL DEFAULT 1, "reply" text NOT NULL DEFAULT '', "handled_by" character varying(32) NOT NULL DEFAULT '', "outcome" character varying(16) NOT NULL, "citations" jsonb NOT NULL DEFAULT '[]', "verdict" character varying(16) NOT NULL, "reasons" jsonb NOT NULL DEFAULT '[]', "hard_fail" boolean NOT NULL DEFAULT false, "wrong_decline" boolean NOT NULL DEFAULT false, "answer_page_offered" boolean, "searches" integer, "grader_version" character varying(32) NOT NULL DEFAULT '', "ms" integer NOT NULL DEFAULT 0, CONSTRAINT "PK_chatbot_checkup_results_id" PRIMARY KEY ("id"), CONSTRAINT "CHK_chatbot_checkup_results_verdict" CHECK ("verdict" IN ('pass', 'fail', 'needs_input', 'error')), CONSTRAINT "FK_chatbot_checkup_results_run" FOREIGN KEY ("run_id") REFERENCES "chatbot_checkup_runs"("id") ON DELETE CASCADE, CONSTRAINT "FK_chatbot_checkup_results_case" FOREIGN KEY ("case_id") REFERENCES "chatbot_checkup_cases"("id") ON DELETE CASCADE)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_chatbot_checkup_results_run" ON "chatbot_checkup_results" ("run_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "chatbot_checkup_results"`);
    await queryRunner.query(`DROP TABLE "chatbot_checkup_runs"`);
    await queryRunner.query(`DROP TABLE "chatbot_checkup_cases"`);
  }
}
