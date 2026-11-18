import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Roadmap v2's one notification stream (plans/roadmap-builder-merge §4.8,
 * §5.2, §5.6).
 *
 * - `roadmap_notifications`: one notice to one person, with the item, the
 *   session it came from, a kind (CHECK = RoadmapNotificationKind), a JSON
 *   payload, read state and a `groupKey` (item + kind + 10-minute bucket) so a
 *   burst collapses into one inbox line. Builder and plan notification writers
 *   dual-write here; their own tables stay the ones read until cutover.
 * - `roadmap_watches`: (user, item) → all | milestones | none. A missing row
 *   is the default for the relationship (author/lead All, voter Milestones).
 * - `roadmap_item_reads`: (user, item) → lastSeenAt, for unread dots.
 *
 * Additive only. Nothing reads these tables while `roadmapV2Enabled` is off.
 */
export class CreateRoadmapNotificationsWatchesReads1983000000200 implements MigrationInterface {
  name = 'CreateRoadmapNotificationsWatchesReads1983000000200';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "roadmap_notifications" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "recipientUserId" integer NOT NULL,
        "itemId" uuid NULL,
        "sessionId" uuid NULL,
        "kind" varchar(24) NOT NULL,
        "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "groupKey" varchar(160) NOT NULL,
        "readAt" timestamptz NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_roadmap_notifications" PRIMARY KEY ("id"),
        CONSTRAINT "FK_roadmap_notifications_recipient" FOREIGN KEY ("recipientUserId")
          REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_roadmap_notifications_item" FOREIGN KEY ("itemId")
          REFERENCES "roadmap_opportunities"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_roadmap_notifications_session" FOREIGN KEY ("sessionId")
          REFERENCES "builder_sessions"("id") ON DELETE SET NULL,
        CONSTRAINT "CHK_roadmap_notifications_kind" CHECK ("kind" IN (
          'submitted', 'accepted', 'declined', 'lead_assigned', 'assigned_to_you',
          'handed_back', 'agent_question', 'mention', 'answers_conflict',
          'decision_needed', 'shipped', 'outcome_reviewed', 'release_held',
          'release_failed', 'breaker_open', 'budget', 'activity'
        )),
        CONSTRAINT "CHK_roadmap_notifications_payload" CHECK (
          jsonb_typeof("payload") = 'object' AND octet_length("payload"::text) <= 16384
        )
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_roadmap_notifications_recipient"
         ON "roadmap_notifications" ("recipientUserId", "readAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_roadmap_notifications_recipient_created"
         ON "roadmap_notifications" ("recipientUserId", "createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_roadmap_notifications_item"
         ON "roadmap_notifications" ("itemId")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "roadmap_watches" (
        "userId" integer NOT NULL,
        "itemId" uuid NOT NULL,
        "level" varchar(10) NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_roadmap_watches" PRIMARY KEY ("userId", "itemId"),
        CONSTRAINT "FK_roadmap_watches_user" FOREIGN KEY ("userId")
          REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_roadmap_watches_item" FOREIGN KEY ("itemId")
          REFERENCES "roadmap_opportunities"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_roadmap_watches_level" CHECK ("level" IN ('all', 'milestones', 'none'))
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_roadmap_watches_item" ON "roadmap_watches" ("itemId")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "roadmap_item_reads" (
        "userId" integer NOT NULL,
        "itemId" uuid NOT NULL,
        "lastSeenAt" timestamptz NOT NULL,
        CONSTRAINT "PK_roadmap_item_reads" PRIMARY KEY ("userId", "itemId"),
        CONSTRAINT "FK_roadmap_item_reads_user" FOREIGN KEY ("userId")
          REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_roadmap_item_reads_item" FOREIGN KEY ("itemId")
          REFERENCES "roadmap_opportunities"("id") ON DELETE CASCADE
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "roadmap_item_reads"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "roadmap_watches"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "roadmap_notifications"`);
  }
}
