import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The Ally guide's own tables (plans/ally-guide/plan.md §8.1) — the ones
 * milestone M1 needs. Tables for later milestones (advice lines, outreach,
 * baseline snapshots, lessons, evals) are added with those milestones.
 *
 *  - `guide_visitors` — anonymous visitors (token hash only), claimed on sign-in.
 *  - `guide_threads` — one learner's (or visitor's) conversation for one
 *    course. One ACTIVE thread per (user, tenant, track).
 *  - `guide_messages` — the transcript. `renderedContent` / `providerBlocks`
 *    are what the model saw, replayed byte for byte (Claude 5.5 rejects
 *    edited history once thinking blocks are present), so they are never
 *    updated after the turn that wrote them.
 *  - `guide_thread_events` — the SSE outbox, replayed after `Last-Event-ID`.
 *  - `guide_cards` — cards presented in a thread and their state.
 *  - `guide_triggers` — platform events waiting to be folded into a turn,
 *    de-duplicated by `dedupeKey`.
 *  - `guide_learner_memories`, `guide_learner_prefs`, `guide_notebook_entries`
 *    — per (user, tenant); the learner can view and delete them.
 *  - `guide_appointments` — the time a learner chose to come back.
 *  - `guide_org_profiles` — the org layer (wellbeing lines, supervisor wording…).
 *  - `guide_crisis_responses` — clinician-approved fixed crisis copy per language.
 *  - `guide_signals`, `guide_turn_feedback` — inputs to the learning loop.
 *
 * Account deletion cascades to every row keyed by a user (plan §8.2).
 * varchar + CHECK, every CHECK covered by check-constraints-cover-enums.spec.ts.
 */
export class CreateGuideTables1980620000000 implements MigrationInterface {
  name = 'CreateGuideTables1980620000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "guide_visitors" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tokenHash" character varying(64) NOT NULL,
        "ipHash" character varying(64),
        "messageCount" integer NOT NULL DEFAULT 0,
        "costUsd" numeric(12,6) NOT NULL DEFAULT 0,
        "claimedByUserId" integer,
        "claimedTenantId" character varying,
        "claimedAt" TIMESTAMP,
        "lastSeenAt" TIMESTAMP NOT NULL DEFAULT now(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_guide_visitors_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_guide_visitors_token_hash" UNIQUE ("tokenHash")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_guide_visitors_unclaimed_created" ON "guide_visitors" ("createdAt") WHERE "claimedAt" IS NULL`,
    );

    await queryRunner.query(
      `CREATE TABLE "guide_threads" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" integer,
        "visitorId" uuid,
        "trackId" uuid NOT NULL,
        "trackEnrollmentId" uuid,
        "status" character varying(16) NOT NULL DEFAULT 'active',
        "mode" character varying(20) NOT NULL DEFAULT 'NORMAL',
        "modeChangedAt" TIMESTAMP,
        "languageCode" character varying(16),
        "epoch" integer NOT NULL DEFAULT 0,
        "epochSnapshot" jsonb,
        "releaseId" uuid,
        "arm" character varying(16),
        "costUsd" numeric(12,6) NOT NULL DEFAULT 0,
        "lastMessageSeq" integer NOT NULL DEFAULT 0,
        "lastEventSeq" integer NOT NULL DEFAULT 0,
        "pacing" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "lastLearnerActivityAt" TIMESTAMP,
        "mergedIntoThreadId" uuid,
        "completedAt" TIMESTAMP,
        "tenant_id" character varying,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_guide_threads_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_guide_threads_user" FOREIGN KEY ("userId")
          REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_guide_threads_visitor" FOREIGN KEY ("visitorId")
          REFERENCES "guide_visitors"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_guide_threads_track" FOREIGN KEY ("trackId")
          REFERENCES "tracks"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_guide_threads_enrollment" FOREIGN KEY ("trackEnrollmentId")
          REFERENCES "track_enrollments"("id") ON DELETE SET NULL,
        CONSTRAINT "CHK_guide_threads_owner" CHECK ("userId" IS NOT NULL OR "visitorId" IS NOT NULL),
        CONSTRAINT "CHK_guide_threads_status" CHECK ("status" IN (
          'active', 'merged', 'completed', 'archived'
        )),
        CONSTRAINT "CHK_guide_threads_mode" CHECK ("mode" IN (
          'NORMAL', 'CARE', 'CRISIS', 'CRISIS_FOLLOWUP'
        ))
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_guide_threads_active_user_track" ON "guide_threads" ("userId", "tenant_id", "trackId") WHERE "status" = 'active' AND "userId" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_guide_threads_visitor_track" ON "guide_threads" ("visitorId", "trackId") WHERE "visitorId" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_guide_threads_track" ON "guide_threads" ("trackId")`,
    );

    await queryRunner.query(
      `CREATE TABLE "guide_messages" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "threadId" uuid NOT NULL,
        "seq" integer NOT NULL,
        "role" character varying(16) NOT NULL,
        "channel" character varying(8) NOT NULL DEFAULT 'text',
        "kind" character varying(16) NOT NULL DEFAULT 'chat',
        "content" text,
        "renderedContent" jsonb,
        "providerBlocks" jsonb,
        "toolCalls" jsonb,
        "toolResults" jsonb,
        "turnId" uuid,
        "clientTurnId" character varying(64),
        "metadata" jsonb,
        "flags" jsonb,
        "redactedContent" text,
        "tenant_id" character varying,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_guide_messages_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_guide_messages_thread_seq" UNIQUE ("threadId", "seq"),
        CONSTRAINT "FK_guide_messages_thread" FOREIGN KEY ("threadId")
          REFERENCES "guide_threads"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_guide_messages_role" CHECK ("role" IN ('learner', 'ally', 'system_note')),
        CONSTRAINT "CHK_guide_messages_channel" CHECK ("channel" IN ('text', 'voice', 'event')),
        CONSTRAINT "CHK_guide_messages_kind" CHECK ("kind" IN (
          'chat', 'crisis_fixed', 'fixed', 'recap', 'nudge'
        ))
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_guide_messages_turn" ON "guide_messages" ("turnId") WHERE "turnId" IS NOT NULL`,
    );

    await queryRunner.query(
      `CREATE TABLE "guide_thread_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "threadId" uuid NOT NULL,
        "seq" integer NOT NULL,
        "type" character varying(32) NOT NULL,
        "payload" jsonb NOT NULL,
        "turnId" uuid,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_guide_thread_events_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_guide_thread_events_thread_seq" UNIQUE ("threadId", "seq"),
        CONSTRAINT "FK_guide_thread_events_thread" FOREIGN KEY ("threadId")
          REFERENCES "guide_threads"("id") ON DELETE CASCADE
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_guide_thread_events_created" ON "guide_thread_events" ("createdAt")`,
    );

    await queryRunner.query(
      `CREATE TABLE "guide_cards" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "threadId" uuid NOT NULL,
        "kind" character varying(24) NOT NULL,
        "presentation" character varying(8) NOT NULL,
        "state" character varying(12) NOT NULL DEFAULT 'announced',
        "tone" character varying(8),
        "title" character varying(255) NOT NULL,
        "trackItemId" uuid,
        "trackItemProgressId" uuid,
        "payload" jsonb,
        "microActivity" jsonb,
        "presentedSeq" integer,
        "verifiedAt" TIMESTAMP,
        "tenant_id" character varying,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_guide_cards_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_guide_cards_thread" FOREIGN KEY ("threadId")
          REFERENCES "guide_threads"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_guide_cards_kind" CHECK ("kind" IN (
          'course_info', 'course_item', 'micro_activity', 'chapter_title',
          'scene_receipt', 'closing_ritual', 'finale', 'resource',
          'crisis_resources', 'sign_in', 'access_denied'
        )),
        CONSTRAINT "CHK_guide_cards_presentation" CHECK ("presentation" IN ('inline', 'shelf', 'theatre')),
        CONSTRAINT "CHK_guide_cards_state" CHECK ("state" IN (
          'announced', 'ready', 'active', 'done', 'failed', 'superseded', 'dismissed'
        )),
        CONSTRAINT "CHK_guide_cards_tone" CHECK ("tone" IS NULL OR "tone" IN ('quiet', 'warm', 'festive'))
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_guide_cards_thread" ON "guide_cards" ("threadId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_guide_cards_thread_item" ON "guide_cards" ("threadId", "trackItemId") WHERE "trackItemId" IS NOT NULL`,
    );

    await queryRunner.query(
      `CREATE TABLE "guide_triggers" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "threadId" uuid NOT NULL,
        "kind" character varying(48) NOT NULL,
        "dedupeKey" character varying(160) NOT NULL,
        "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "status" character varying(12) NOT NULL DEFAULT 'pending',
        "runAfter" TIMESTAMP,
        "consumedByTurnId" uuid,
        "tenant_id" character varying,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_guide_triggers_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_guide_triggers_dedupe" UNIQUE ("dedupeKey"),
        CONSTRAINT "FK_guide_triggers_thread" FOREIGN KEY ("threadId")
          REFERENCES "guide_threads"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_guide_triggers_status" CHECK ("status" IN ('pending', 'consumed', 'discarded'))
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_guide_triggers_thread_pending" ON "guide_triggers" ("threadId") WHERE "status" = 'pending'`,
    );

    await queryRunner.query(
      `CREATE TABLE "guide_learner_memories" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" integer NOT NULL,
        "kind" character varying(24) NOT NULL,
        "body" character varying(280) NOT NULL,
        "bodyHash" character varying(64) NOT NULL,
        "status" character varying(12) NOT NULL DEFAULT 'active',
        "sourceThreadId" uuid,
        "confidence" real,
        "revision" integer NOT NULL DEFAULT 1,
        "lastConfirmedAt" TIMESTAMP,
        "expiresAt" TIMESTAMP,
        "tenant_id" character varying NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_guide_learner_memories_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_guide_learner_memories_user" FOREIGN KEY ("userId")
          REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_guide_learner_memories_kind" CHECK ("kind" IN (
          'preference', 'goal', 'possible_self', 'strength', 'struggle',
          'context', 'commitment', 'unique_outcome'
        )),
        CONSTRAINT "CHK_guide_learner_memories_status" CHECK ("status" IN ('active', 'deleted'))
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_guide_learner_memories_owner" ON "guide_learner_memories" ("userId", "tenant_id", "status")`,
    );

    await queryRunner.query(
      `CREATE TABLE "guide_learner_prefs" (
        "userId" integer NOT NULL,
        "tenant_id" character varying NOT NULL,
        "prefs" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_guide_learner_prefs" PRIMARY KEY ("userId", "tenant_id"),
        CONSTRAINT "FK_guide_learner_prefs_user" FOREIGN KEY ("userId")
          REFERENCES "users"("id") ON DELETE CASCADE
      )`,
    );

    await queryRunner.query(
      `CREATE TABLE "guide_notebook_entries" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "userId" integer NOT NULL,
        "threadId" uuid,
        "trackId" uuid,
        "kind" character varying(20) NOT NULL,
        "text" text NOT NULL,
        "sourceMessageId" uuid,
        "tenant_id" character varying NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP,
        CONSTRAINT "PK_guide_notebook_entries_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_guide_notebook_entries_user" FOREIGN KEY ("userId")
          REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_guide_notebook_entries_thread" FOREIGN KEY ("threadId")
          REFERENCES "guide_threads"("id") ON DELETE SET NULL,
        CONSTRAINT "CHK_guide_notebook_entries_kind" CHECK ("kind" IN (
          'first_move', 'possible_self', 'journal_line', 'rehearsed_line',
          'reflection', 'noticing'
        ))
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_guide_notebook_entries_owner" ON "guide_notebook_entries" ("userId", "tenant_id") WHERE "deletedAt" IS NULL`,
    );

    await queryRunner.query(
      `CREATE TABLE "guide_appointments" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "threadId" uuid NOT NULL,
        "userId" integer NOT NULL,
        "at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "timezone" character varying(64) NOT NULL,
        "status" character varying(12) NOT NULL DEFAULT 'scheduled',
        "tenant_id" character varying NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_guide_appointments_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_guide_appointments_thread" FOREIGN KEY ("threadId")
          REFERENCES "guide_threads"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_guide_appointments_user" FOREIGN KEY ("userId")
          REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_guide_appointments_status" CHECK ("status" IN (
          'scheduled', 'sent', 'cancelled', 'missed'
        ))
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_guide_appointments_due" ON "guide_appointments" ("at") WHERE "status" = 'scheduled'`,
    );

    await queryRunner.query(
      `CREATE TABLE "guide_org_profiles" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" character varying NOT NULL,
        "profile" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "version" integer NOT NULL DEFAULT 1,
        "updatedBy" integer,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_guide_org_profiles_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_guide_org_profiles_tenant" UNIQUE ("tenant_id")
      )`,
    );

    await queryRunner.query(
      `CREATE TABLE "guide_crisis_responses" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "scope" character varying(12) NOT NULL,
        "tenant_id" character varying,
        "languageCode" character varying(16) NOT NULL,
        "body" text NOT NULL,
        "version" integer NOT NULL DEFAULT 1,
        "active" boolean NOT NULL DEFAULT true,
        "approvedBy" integer,
        "approvedAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_guide_crisis_responses_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_guide_crisis_responses_scope" CHECK ("scope" IN ('platform', 'tenant')),
        CONSTRAINT "CHK_guide_crisis_responses_tenant_scope" CHECK (
          ("scope" = 'platform' AND "tenant_id" IS NULL) OR
          ("scope" = 'tenant' AND "tenant_id" IS NOT NULL)
        )
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_guide_crisis_responses_active" ON "guide_crisis_responses" ("scope", COALESCE("tenant_id", ''), "languageCode") WHERE "active" = true`,
    );

    await queryRunner.query(
      `CREATE TABLE "guide_signals" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "kind" character varying(40) NOT NULL,
        "value" real,
        "payload" jsonb,
        "threadId" uuid,
        "messageId" uuid,
        "userId" integer,
        "visitorId" uuid,
        "releaseId" uuid,
        "arm" character varying(16),
        "tenant_id" character varying,
        "occurredAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_guide_signals_id" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_guide_signals_kind_occurred" ON "guide_signals" ("kind", "occurredAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_guide_signals_thread" ON "guide_signals" ("threadId") WHERE "threadId" IS NOT NULL`,
    );

    await queryRunner.query(
      `CREATE TABLE "guide_turn_feedback" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "messageId" uuid NOT NULL,
        "userId" integer NOT NULL,
        "rating" smallint NOT NULL,
        "comment" text,
        "tenant_id" character varying NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_guide_turn_feedback_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_guide_turn_feedback_message_user" UNIQUE ("messageId", "userId"),
        CONSTRAINT "FK_guide_turn_feedback_message" FOREIGN KEY ("messageId")
          REFERENCES "guide_messages"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_guide_turn_feedback_user" FOREIGN KEY ("userId")
          REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_guide_turn_feedback_rating" CHECK ("rating" IN (-1, 1))
      )`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of [
      'guide_turn_feedback',
      'guide_signals',
      'guide_crisis_responses',
      'guide_org_profiles',
      'guide_appointments',
      'guide_notebook_entries',
      'guide_learner_prefs',
      'guide_learner_memories',
      'guide_triggers',
      'guide_cards',
      'guide_thread_events',
      'guide_messages',
      'guide_threads',
      'guide_visitors',
    ]) {
      await queryRunner.query(`DROP TABLE IF EXISTS "${table}"`);
    }
  }
}
