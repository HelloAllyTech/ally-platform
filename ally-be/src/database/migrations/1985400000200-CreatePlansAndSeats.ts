import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CR1 Part C — plans and seats.
 *
 *   - plans            Free, Pro and internal as data (limits NULL = unlimited); super admins edit them
 *                      and add more with no code.
 *   - seat_types       Basic and Premium as data (messages per month per seat, rank).
 *   - subscriptions    one per chatbot creator: the plan their assistants count against.
 *   - seats            per published assistant, for invited people: included or extra, each with its
 *                      own start date and renewal; assigned to an email (an invite) or to nobody yet.
 *   - usage_counters   per period and subject (a seat; an assistant's customers; a creator's
 *                      owner-side runs), with the limit at the time and when 80% / 100% were alerted.
 *   - usage_counter_hits  what made each count, unique on (runId, kind): a redelivered message or
 *                      a retried request never counts twice.
 *   - customer_activity  when each customer conversation was last active, so a "new conversation"
 *                      is one after a 24-hour gap, whatever the channel.
 *
 * Seeds the numbers agreed at the CR1 plan stop. Prices stay blank (entered on the Plans screen).
 * Subscriptions, seats and starting tokens are written by `npm run billing:backfill` (dry run first).
 */
export class CreatePlansAndSeats1985400000200 implements MigrationInterface {
  name = 'CreatePlansAndSeats1985400000200';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "seat_types" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "key" character varying(40) NOT NULL,
        "name" character varying(100) NOT NULL,
        "messagesPerMonth" integer,
        "rank" integer NOT NULL DEFAULT 1,
        "priceMicros" numeric(20,3),
        "active" boolean NOT NULL DEFAULT true,
        CONSTRAINT "PK_seat_types_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_seat_types_key" UNIQUE ("key"),
        CONSTRAINT "CHK_seat_types_messages" CHECK ("messagesPerMonth" IS NULL OR "messagesPerMonth" >= 0)
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "plans" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "key" character varying(40) NOT NULL,
        "name" character varying(100) NOT NULL,
        "maxPublished" integer,
        "includedSeats" integer NOT NULL DEFAULT 0,
        "includedSeatTypeId" uuid,
        "customerConversations" integer,
        "ownerRuns" integer,
        "seatsRequired" boolean NOT NULL DEFAULT true,
        "priceMicros" numeric(20,3),
        "active" boolean NOT NULL DEFAULT true,
        CONSTRAINT "PK_plans_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_plans_key" UNIQUE ("key"),
        CONSTRAINT "FK_plans_seat_type" FOREIGN KEY ("includedSeatTypeId") REFERENCES "seat_types"("id"),
        CONSTRAINT "CHK_plans_limits" CHECK (
          ("maxPublished" IS NULL OR "maxPublished" >= 0) AND "includedSeats" >= 0
          AND ("customerConversations" IS NULL OR "customerConversations" >= 0)
          AND ("ownerRuns" IS NULL OR "ownerRuns" >= 0))
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "subscriptions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "userId" integer NOT NULL,
        "planId" uuid NOT NULL,
        "status" character varying(20) NOT NULL DEFAULT 'active',
        "periodStart" date NOT NULL,
        "periodEnd" date,
        "setBy" integer,
        "note" text,
        CONSTRAINT "PK_subscriptions_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_subscriptions_user" UNIQUE ("userId"),
        CONSTRAINT "FK_subscriptions_plan" FOREIGN KEY ("planId") REFERENCES "plans"("id"),
        CONSTRAINT "CHK_subscriptions_status" CHECK ("status" IN ('active','past_due','cancelled'))
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "seats" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "chatbotId" uuid NOT NULL,
        "seatTypeId" uuid NOT NULL,
        "kind" character varying(20) NOT NULL,
        "assigneeEmail" character varying(320),
        "assigneeUserId" integer,
        "startDate" date NOT NULL,
        "cycle" character varying(20) NOT NULL DEFAULT 'monthly',
        "nextRenewal" date,
        "status" character varying(20) NOT NULL DEFAULT 'active',
        "addedBy" integer,
        "note" text,
        CONSTRAINT "PK_seats_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_seats_chatbot" FOREIGN KEY ("chatbotId") REFERENCES "chatbots"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_seats_type" FOREIGN KEY ("seatTypeId") REFERENCES "seat_types"("id"),
        CONSTRAINT "CHK_seats_kind" CHECK ("kind" IN ('included','extra')),
        CONSTRAINT "CHK_seats_cycle" CHECK ("cycle" IN ('monthly')),
        CONSTRAINT "CHK_seats_status" CHECK ("status" IN ('active','expiring','lapsed','cancelled')),
        CONSTRAINT "CHK_seats_email_lower" CHECK ("assigneeEmail" IS NULL OR "assigneeEmail" = lower("assigneeEmail"))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_seats_chatbot" ON "seats" ("chatbotId", "status")`,
    );
    // One live seat per person per assistant.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_seats_assignee" ON "seats" ("chatbotId", "assigneeEmail")
         WHERE "assigneeEmail" IS NOT NULL AND "status" IN ('active','expiring')`,
    );
    await queryRunner.query(`
      CREATE TABLE "usage_counters" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "subjectType" character varying(30) NOT NULL,
        "subjectId" character varying(120) NOT NULL,
        "periodStart" date NOT NULL,
        "periodEnd" date NOT NULL,
        "count" integer NOT NULL DEFAULT 0,
        "limitAtTime" integer,
        "alerted80At" TIMESTAMP,
        "alerted100At" TIMESTAMP,
        CONSTRAINT "PK_usage_counters_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_usage_counters_subject_period" UNIQUE ("subjectType", "subjectId", "periodStart"),
        CONSTRAINT "CHK_usage_counters_subject" CHECK ("subjectType" IN ('seat','customers','owner_runs'))
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "usage_counter_hits" (
        "runId" character varying(160) NOT NULL,
        "kind" character varying(30) NOT NULL,
        "counterId" uuid NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_usage_counter_hits" PRIMARY KEY ("runId", "kind"),
        CONSTRAINT "FK_usage_counter_hits_counter" FOREIGN KEY ("counterId") REFERENCES "usage_counters"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "customer_activity" (
        "chatbotId" uuid NOT NULL,
        "conversationKey" character varying(160) NOT NULL,
        "lastMessageAt" TIMESTAMP NOT NULL,
        CONSTRAINT "PK_customer_activity" PRIMARY KEY ("chatbotId", "conversationKey")
      )
    `);

    await queryRunner.query(`
      INSERT INTO "seat_types" ("key", "name", "messagesPerMonth", "rank") VALUES
        ('basic', 'Basic', 500, 1),
        ('premium', 'Premium', 3000, 2)
    `);
    await queryRunner.query(`
      INSERT INTO "plans" ("key", "name", "maxPublished", "includedSeats", "includedSeatTypeId", "customerConversations", "ownerRuns", "seatsRequired")
      SELECT p.key, p.name, p.max, 5, (SELECT id FROM seat_types WHERE key = 'basic'), p.conv, p.runs, p.seats
        FROM (VALUES
          ('free', 'Free', 3, 300, 100, true),
          ('pro', 'Pro', 20, 3000, 1000, true),
          -- Ally's team and test accounts: nothing is limited and invited people need no seat.
          ('internal', 'Internal', NULL::int, NULL::int, NULL::int, false)
        ) AS p(key, name, max, conv, runs, seats)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "customer_activity"`);
    await queryRunner.query(`DROP TABLE "usage_counter_hits"`);
    await queryRunner.query(`DROP TABLE "usage_counters"`);
    await queryRunner.query(`DROP TABLE "seats"`);
    await queryRunner.query(`DROP TABLE "subscriptions"`);
    await queryRunner.query(`DROP TABLE "plans"`);
    await queryRunner.query(`DROP TABLE "seat_types"`);
  }
}
