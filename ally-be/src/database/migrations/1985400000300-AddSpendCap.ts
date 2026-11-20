import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Spend cap — replaces token allowances as the guard on what a creator's assistants may cost.
 *
 *   - plans.costCapMicros          a monthly dollar cap per creator on this plan (NULL = no cap).
 *                                  Entered on the Plans screen; never shown to owners.
 *   - subscriptions.costCapMicros  one creator's own cap (NULL = the plan's).
 *   - subscriptions.costCapOff     this creator is never capped (Ally's team and test accounts).
 *   - spend_periods                a creator's cost so far in each plan period, kept in step with
 *                                  `usage_events` in the same transaction, with when 80% / 100% of
 *                                  the cap were alerted.
 *   - cost_alerts.kind             gains `spend_cap`.
 *
 * Users whose tokens were "unlimited" keep that: their subscription is marked never capped (one is
 * created on the default plan, anchored where their counters already reset, if they had none).
 *
 * `token_grants` and `token_balances` are left as they are and no longer read.
 */
export class AddSpendCap1985400000300 implements MigrationInterface {
  name = 'AddSpendCap1985400000300';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "plans"
        ADD "costCapMicros" numeric(20,3),
        ADD CONSTRAINT "CHK_plans_cost_cap" CHECK ("costCapMicros" IS NULL OR "costCapMicros" > 0)
    `);
    await queryRunner.query(`
      ALTER TABLE "subscriptions"
        ADD "costCapMicros" numeric(20,3),
        ADD "costCapOff" boolean NOT NULL DEFAULT false,
        ADD CONSTRAINT "CHK_subscriptions_cost_cap" CHECK ("costCapMicros" IS NULL OR "costCapMicros" > 0)
    `);
    await queryRunner.query(`
      CREATE TABLE "spend_periods" (
        "userId" integer NOT NULL,
        "periodStart" date NOT NULL,
        "periodEnd" date NOT NULL,
        "costMicros" numeric(20,3) NOT NULL DEFAULT 0,
        "alerted80At" TIMESTAMP,
        "alerted100At" TIMESTAMP,
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_spend_periods" PRIMARY KEY ("userId", "periodStart"),
        CONSTRAINT "CHK_spend_periods_cost" CHECK ("costMicros" >= 0)
      )
    `);
    await queryRunner.query(
      `ALTER TABLE "cost_alerts" DROP CONSTRAINT "CHK_cost_alerts_kind"`,
    );
    await queryRunner.query(`
      ALTER TABLE "cost_alerts" ADD CONSTRAINT "CHK_cost_alerts_kind"
        CHECK ("kind" IN ('daily_budget','assistant_spike','conversation_cost','unpriced_model','usage_feed_off','token_drift','seat_renewal','spend_cap'))
    `);

    await queryRunner.query(`
      UPDATE "subscriptions" SET "costCapOff" = true
       WHERE "userId" IN (SELECT "userId" FROM "token_balances" WHERE "unlimited")
    `);
    await queryRunner.query(`
      INSERT INTO "subscriptions" ("userId", "planId", "status", "periodStart", "costCapOff", "note")
      SELECT b."userId", (SELECT id FROM "plans" WHERE key = 'free'), 'active',
             (SELECT min(c."createdAt")::date FROM "chatbots" c WHERE c.created_by = b."userId"),
             true, 'Never capped: carried over from unlimited tokens'
        FROM "token_balances" b
       WHERE b."unlimited"
         AND EXISTS (SELECT 1 FROM "chatbots" c WHERE c.created_by = b."userId")
         AND NOT EXISTS (SELECT 1 FROM "subscriptions" s WHERE s."userId" = b."userId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "cost_alerts" WHERE "kind" = 'spend_cap'`,
    );
    await queryRunner.query(
      `ALTER TABLE "cost_alerts" DROP CONSTRAINT "CHK_cost_alerts_kind"`,
    );
    await queryRunner.query(`
      ALTER TABLE "cost_alerts" ADD CONSTRAINT "CHK_cost_alerts_kind"
        CHECK ("kind" IN ('daily_budget','assistant_spike','conversation_cost','unpriced_model','usage_feed_off','token_drift','seat_renewal'))
    `);
    await queryRunner.query(`DROP TABLE "spend_periods"`);
    await queryRunner.query(`
      ALTER TABLE "subscriptions"
        DROP CONSTRAINT "CHK_subscriptions_cost_cap",
        DROP COLUMN "costCapOff",
        DROP COLUMN "costCapMicros"
    `);
    await queryRunner.query(`
      ALTER TABLE "plans"
        DROP CONSTRAINT "CHK_plans_cost_cap",
        DROP COLUMN "costCapMicros"
    `);
  }
}
