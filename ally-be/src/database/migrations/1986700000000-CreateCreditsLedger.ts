import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Stage 6 credits: the payer (`billing_accounts`), staff grants, chatbot budgets, reservations,
 * per-end-person spend, end persons and their phone/email identities, warning-email marks, paused
 * background jobs, and
 * five nullable columns on `usage_events` (payer, end person, task, funding, charged amount).
 *
 * Additive only (expand step). The plan, seat and spend-cap tables stay and stay written; they are
 * dropped in a later contract release. `down` drops what this added.
 */
export class CreateCreditsLedger1986700000000 implements MigrationInterface {
  name = 'CreateCreditsLedger1986700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "billing_accounts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "owner_user_id" integer NOT NULL,
        "status" character varying(16) NOT NULL DEFAULT 'active',
        "granted_micros" numeric(20,3) NOT NULL DEFAULT 0,
        "set_aside_micros" numeric(20,3) NOT NULL DEFAULT 0,
        "builder_spent_micros" numeric(20,3) NOT NULL DEFAULT 0,
        "reserved_micros" numeric(20,3) NOT NULL DEFAULT 0,
        "grant_epoch" integer NOT NULL DEFAULT 0,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_billing_accounts" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_billing_accounts_owner" UNIQUE ("owner_user_id"),
        CONSTRAINT "CHK_billing_accounts_status" CHECK ("status" IN ('active', 'suspended')),
        CONSTRAINT "CHK_billing_accounts_reserved" CHECK ("reserved_micros" >= 0)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "credit_grants" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "account_id" uuid NOT NULL,
        "amount_micros" numeric(20,3) NOT NULL,
        "kind" character varying(16) NOT NULL,
        "note" text NOT NULL,
        "granted_by" integer,
        "epoch" integer NOT NULL DEFAULT 0,
        "idempotency_key" character varying(120),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_credit_grants" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_credit_grants_idempotency_key" UNIQUE ("idempotency_key"),
        CONSTRAINT "FK_credit_grants_account" FOREIGN KEY ("account_id")
          REFERENCES "billing_accounts"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_credit_grants_kind" CHECK ("kind" IN ('grant', 'adjustment')),
        CONSTRAINT "CHK_credit_grants_grant_positive" CHECK ("kind" <> 'grant' OR "amount_micros" > 0)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_credit_grants_account" ON "credit_grants" ("account_id", "created_at")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "chatbot_budgets" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "account_id" uuid NOT NULL,
        "chatbot_id" uuid NOT NULL,
        "set_aside_micros" numeric(20,3) NOT NULL DEFAULT 0,
        "spent_micros" numeric(20,3) NOT NULL DEFAULT 0,
        "reserved_micros" numeric(20,3) NOT NULL DEFAULT 0,
        "epoch" integer NOT NULL DEFAULT 0,
        "archived_at" TIMESTAMP,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_chatbot_budgets" PRIMARY KEY ("id"),
        CONSTRAINT "FK_chatbot_budgets_account" FOREIGN KEY ("account_id")
          REFERENCES "billing_accounts"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_chatbot_budgets_set_aside" CHECK ("set_aside_micros" >= 0),
        CONSTRAINT "CHK_chatbot_budgets_reserved" CHECK ("reserved_micros" >= 0)
      )
    `);
    // One open budget per chatbot; archived rows stay as history. No FK to chatbots: a chatbot's
    // removal must not cascade its money away.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_chatbot_budgets_open" ON "chatbot_budgets" ("chatbot_id") WHERE "archived_at" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_chatbot_budgets_account" ON "chatbot_budgets" ("account_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "end_persons" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "chatbot_id" uuid NOT NULL,
        "display" character varying(200),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_end_persons" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_end_persons_chatbot" ON "end_persons" ("chatbot_id")`,
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "end_person_identities" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "end_person_id" uuid NOT NULL,
        "chatbot_id" uuid NOT NULL,
        "kind" character varying(8) NOT NULL,
        "value" character varying(254) NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_end_person_identities" PRIMARY KEY ("id"),
        CONSTRAINT "FK_end_person_identities_person" FOREIGN KEY ("end_person_id")
          REFERENCES "end_persons"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_end_person_identities_kind" CHECK ("kind" IN ('phone', 'email'))
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_end_person_identities_chatbot_kind_value" ON "end_person_identities" ("chatbot_id", "kind", "value")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_end_person_identities_person" ON "end_person_identities" ("end_person_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "end_person_spend" (
        "end_person_id" uuid NOT NULL,
        "period_kind" character varying(8) NOT NULL,
        "period_start" date NOT NULL,
        "chatbot_id" uuid NOT NULL,
        "spent_micros" numeric(20,3) NOT NULL DEFAULT 0,
        "reserved_micros" numeric(20,3) NOT NULL DEFAULT 0,
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_end_person_spend" PRIMARY KEY ("end_person_id", "period_kind", "period_start"),
        CONSTRAINT "CHK_end_person_spend_kind" CHECK ("period_kind" IN ('day', 'week', 'month')),
        CONSTRAINT "CHK_end_person_spend_reserved" CHECK ("reserved_micros" >= 0)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "credit_reservations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "run_id" character varying(120) NOT NULL,
        "account_id" uuid NOT NULL,
        "chatbot_id" uuid,
        "end_person_id" uuid,
        "funding" character varying(10) NOT NULL,
        "reserved_micros" numeric(20,3) NOT NULL,
        "consumed_micros" numeric(20,3) NOT NULL DEFAULT 0,
        "state" character varying(10) NOT NULL DEFAULT 'reserved',
        "periods" jsonb NOT NULL DEFAULT '[]',
        "expires_at" TIMESTAMP NOT NULL,
        "settled_at" TIMESTAMP,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_credit_reservations" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_credit_reservations_run" UNIQUE ("run_id"),
        CONSTRAINT "CHK_credit_reservations_funding" CHECK ("funding" IN ('free', 'budget')),
        CONSTRAINT "CHK_credit_reservations_state" CHECK ("state" IN ('reserved', 'settled', 'released'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_credit_reservations_open" ON "credit_reservations" ("expires_at") WHERE "state" = 'reserved'`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "credit_warnings" (
        "subject_type" character varying(10) NOT NULL,
        "subject_id" character varying(64) NOT NULL,
        "epoch" integer NOT NULL,
        "percent" smallint NOT NULL,
        "sent_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_credit_warnings" PRIMARY KEY ("subject_type", "subject_id", "epoch", "percent"),
        CONSTRAINT "CHK_credit_warnings_subject_type" CHECK ("subject_type" IN ('account', 'budget'))
      )
    `);

    // Background AI work paused at a zero free balance (site reading, re-indexing): resumed by the
    // ledger's sweep once the paying account has credits again, never failed for good.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "credit_paused_jobs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "kind" character varying(40) NOT NULL,
        "subject_id" character varying(120) NOT NULL,
        "account_id" uuid,
        "owner_user_id" integer,
        "reason" character varying(40) NOT NULL,
        "payload" jsonb NOT NULL DEFAULT '{}',
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_credit_paused_jobs" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_credit_paused_jobs_subject" ON "credit_paused_jobs" ("kind", "subject_id")`,
    );

    await queryRunner.query(`
      ALTER TABLE "usage_events"
        ADD COLUMN IF NOT EXISTS "payerAccountId" uuid,
        ADD COLUMN IF NOT EXISTS "endPersonId" uuid,
        ADD COLUMN IF NOT EXISTS "task" character varying(80),
        ADD COLUMN IF NOT EXISTS "funding" character varying(10),
        ADD COLUMN IF NOT EXISTS "chargedMicros" numeric(20,3)
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_usage_events_payer" ON "usage_events" ("payerAccountId", "createdAt") WHERE "payerAccountId" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_usage_events_end_person" ON "usage_events" ("endPersonId", "createdAt") WHERE "endPersonId" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_usage_events_end_person"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_usage_events_payer"`);
    await queryRunner.query(`
      ALTER TABLE "usage_events"
        DROP COLUMN IF EXISTS "chargedMicros",
        DROP COLUMN IF EXISTS "funding",
        DROP COLUMN IF EXISTS "task",
        DROP COLUMN IF EXISTS "endPersonId",
        DROP COLUMN IF EXISTS "payerAccountId"
    `);
    await queryRunner.query(`DROP TABLE IF EXISTS "credit_paused_jobs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "credit_warnings"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "credit_reservations"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "end_person_spend"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "end_person_identities"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "end_persons"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "chatbot_budgets"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "credit_grants"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "billing_accounts"`);
  }
}
