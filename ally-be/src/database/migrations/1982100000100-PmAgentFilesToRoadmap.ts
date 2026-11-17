import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The PM Agent stops building and files accepted cards to the roadmap (docs/pm-agent.md,
 * "Filing to the roadmap").
 *
 * Schema:
 *  - `pm_agent_cards.status` gains `filed` and `roadmap_archived`; `acceptPath` gains `roadmap`.
 *  - `pm_agent_cards.roadmapFiling` (jsonb): the critic's readiness grading of the card's roadmap
 *    entry, and any duplicate stop / File anyway at filing.
 *  - `pm_agent_outcomes.roadmapArchived`: filed, then archived on the roadmap (a soft negative).
 *  - `pm_agent_outbox.action` gains `file_roadmap`, now the default for `action` and `step`.
 *  - `roadmap_opportunities.source` gains `pm_agent`.
 *
 * Data, leaving no card in the removed Accept → Builder chain:
 *  - every open `build` outbox row is cancelled;
 *  - a card accepted into Builder but not yet past the undo window, or still waiting for Builder
 *    to start (accepted_pending / queued / designing), and every card in a later Builder state
 *    (building … merged_not_released, failed, needs_attention), becomes `handed_off`: a Builder
 *    session it already has keeps running in Builder as it was, but the PM Agent no longer
 *    tracks it;
 *  - an `open` recommendation with no roadmap entry (`payload.opportunity`) cannot be filed, so
 *    it is `expired`, freeing its queue slot for a card written to the new contract.
 * Each move writes a `pm_agent_card_events` row, as every transition does.
 */
export class PmAgentFilesToRoadmap1982100000100 implements MigrationInterface {
  name = 'PmAgentFilesToRoadmap1982100000100';

  private static readonly CARD_STATUSES = [
    'draft',
    'open',
    'accepted_pending',
    'queued',
    'filed',
    'roadmap_archived',
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

  private static readonly LEGACY_IN_FLIGHT = [
    'accepted_pending',
    'queued',
    'designing',
    'building',
    'pr_open',
    'merged',
    'merged_not_released',
    'failed',
    'needs_attention',
  ];

  private static list(values: string[]): string {
    return values.map((value) => `'${value}'`).join(', ');
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    const list = PmAgentFilesToRoadmap1982100000100.list;

    // ── schema ──────────────────────────────────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE "pm_agent_cards" DROP CONSTRAINT IF EXISTS "CHK_pm_agent_cards_status"`,
    );
    await queryRunner.query(
      `ALTER TABLE "pm_agent_cards" ADD CONSTRAINT "CHK_pm_agent_cards_status" CHECK ("status" IN (${list(PmAgentFilesToRoadmap1982100000100.CARD_STATUSES)}))`,
    );
    await queryRunner.query(
      `ALTER TABLE "pm_agent_cards" DROP CONSTRAINT IF EXISTS "CHK_pm_agent_cards_accept_path"`,
    );
    await queryRunner.query(
      `ALTER TABLE "pm_agent_cards" ADD CONSTRAINT "CHK_pm_agent_cards_accept_path" CHECK ("acceptPath" IS NULL OR "acceptPath" IN ('roadmap', 'builder', 'download'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "pm_agent_cards" ADD COLUMN IF NOT EXISTS "roadmapFiling" jsonb NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "pm_agent_outcomes" ADD COLUMN IF NOT EXISTS "roadmapArchived" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "pm_agent_outbox" DROP CONSTRAINT IF EXISTS "CHK_pm_agent_outbox_action"`,
    );
    await queryRunner.query(
      `ALTER TABLE "pm_agent_outbox" ADD CONSTRAINT "CHK_pm_agent_outbox_action" CHECK ("action" IN ('build', 'file_roadmap'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "pm_agent_outbox" ALTER COLUMN "action" SET DEFAULT 'file_roadmap'`,
    );
    await queryRunner.query(
      `ALTER TABLE "pm_agent_outbox" ALTER COLUMN "step" SET DEFAULT 'file_roadmap'`,
    );
    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunities" DROP CONSTRAINT IF EXISTS "CHK_roadmap_opps_source"`,
    );
    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunities" ADD CONSTRAINT "CHK_roadmap_opps_source" CHECK ("source" IN ('staff', 'consumer', 'pm_agent'))`,
    );

    // ── data: nothing stays in the Builder chain ────────────────────────────
    await queryRunner.query(
      `UPDATE "pm_agent_outbox"
          SET "status" = 'cancelled', "lockedUntil" = NULL,
              "lastError" = 'Accept → Builder was removed; the card is handed off.',
              "updatedAt" = now()
        WHERE "action" = 'build'
          AND "status" IN ('pending', 'running', 'waiting', 'failed')`,
    );
    await this.moveCards(
      queryRunner,
      `"status" IN (${list(PmAgentFilesToRoadmap1982100000100.LEGACY_IN_FLIGHT)})`,
      'handed_off',
      'Accept → Builder was removed. Any Builder session for this card keeps running in Builder; the PM Agent no longer tracks it.',
    );
    await this.moveCards(
      queryRunner,
      `"status" = 'open' AND "kind" = 'recommendation' AND NOT ("payload" ? 'opportunity')`,
      'expired',
      'Written before cards were filed to the roadmap: it has no roadmap entry.',
    );
  }

  /** One conditional move with its audit event, as the card repository writes them. */
  private async moveCards(
    queryRunner: QueryRunner,
    where: string,
    to: string,
    reason: string,
  ): Promise<void> {
    await queryRunner.query(
      `WITH moved AS (
         SELECT id, status AS "fromStatus", version FROM "pm_agent_cards" WHERE ${where}
       ), updated AS (
         UPDATE "pm_agent_cards" c
            SET "status" = $1, "undoUntil" = NULL, "needsYouReason" = NULL,
                "needsYouDismissedAt" = NULL, "updatedAt" = now()
           FROM moved
          WHERE c.id = moved.id
         RETURNING c.id
       )
       INSERT INTO "pm_agent_card_events"
              ("cardId", "type", "fromStatus", "toStatus", "cardVersion", "actorUserId", "detail")
       SELECT moved.id, 'migrated', moved."fromStatus", $1, moved.version, NULL,
              jsonb_build_object('reason', $2::text, 'migration', '1982100000100')
         FROM moved JOIN updated ON updated.id = moved.id`,
      [to, reason],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Cards cannot be put back into the Builder chain; new-status rows are mapped onto the
    // nearest old status so the old CHECKs hold again.
    await queryRunner.query(
      `UPDATE "pm_agent_cards" SET "status" = 'handed_off' WHERE "status" IN ('filed', 'roadmap_archived', 'queued', 'accepted_pending')`,
    );
    await queryRunner.query(
      `UPDATE "pm_agent_cards" SET "acceptPath" = 'download' WHERE "acceptPath" = 'roadmap'`,
    );
    await queryRunner.query(
      `DELETE FROM "pm_agent_outbox" WHERE "action" = 'file_roadmap'`,
    );
    await queryRunner.query(
      `UPDATE "roadmap_opportunities" SET "source" = 'staff' WHERE "source" = 'pm_agent'`,
    );

    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunities" DROP CONSTRAINT IF EXISTS "CHK_roadmap_opps_source"`,
    );
    await queryRunner.query(
      `ALTER TABLE "roadmap_opportunities" ADD CONSTRAINT "CHK_roadmap_opps_source" CHECK ("source" IN ('staff', 'consumer'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "pm_agent_outbox" ALTER COLUMN "step" SET DEFAULT 'create_session'`,
    );
    await queryRunner.query(
      `ALTER TABLE "pm_agent_outbox" ALTER COLUMN "action" SET DEFAULT 'build'`,
    );
    await queryRunner.query(
      `ALTER TABLE "pm_agent_outbox" DROP CONSTRAINT IF EXISTS "CHK_pm_agent_outbox_action"`,
    );
    await queryRunner.query(
      `ALTER TABLE "pm_agent_outbox" ADD CONSTRAINT "CHK_pm_agent_outbox_action" CHECK ("action" IN ('build'))`,
    );
    await queryRunner.query(
      `ALTER TABLE "pm_agent_outcomes" DROP COLUMN IF EXISTS "roadmapArchived"`,
    );
    await queryRunner.query(
      `ALTER TABLE "pm_agent_cards" DROP COLUMN IF EXISTS "roadmapFiling"`,
    );
    await queryRunner.query(
      `ALTER TABLE "pm_agent_cards" DROP CONSTRAINT IF EXISTS "CHK_pm_agent_cards_accept_path"`,
    );
    await queryRunner.query(
      `ALTER TABLE "pm_agent_cards" ADD CONSTRAINT "CHK_pm_agent_cards_accept_path" CHECK ("acceptPath" IS NULL OR "acceptPath" IN ('builder', 'download'))`,
    );
    const old = PmAgentFilesToRoadmap1982100000100.CARD_STATUSES.filter(
      (status) => status !== 'filed' && status !== 'roadmap_archived',
    );
    await queryRunner.query(
      `ALTER TABLE "pm_agent_cards" DROP CONSTRAINT IF EXISTS "CHK_pm_agent_cards_status"`,
    );
    await queryRunner.query(
      `ALTER TABLE "pm_agent_cards" ADD CONSTRAINT "CHK_pm_agent_cards_status" CHECK ("status" IN (${PmAgentFilesToRoadmap1982100000100.list(old)}))`,
    );
  }
}
