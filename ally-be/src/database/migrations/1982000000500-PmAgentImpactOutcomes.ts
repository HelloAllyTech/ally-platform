import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * PM Agent impact checks (+14 / +30 days; docs/pm-agent.md "Contract addendum: impact checks").
 *
 * `pm_agent_outcomes` held exactly one row per card (the decision and its build/release
 * flags). Impact reads become ROWS of the same table, told apart by `kind`:
 *  - `kind = 'decision'`, `day = 0` — the existing row, unchanged (every existing row gets
 *    these defaults, so nothing is backfilled);
 *  - `kind = 'impact'`, `day` 0 (the pre-release baseline), 14 or 30 — written when the card
 *    is released, read by the daily due-reads job.
 *
 * So UNIQUE ("cardId") becomes UNIQUE ("cardId", "kind", "day"), and `decision` /
 * `decidedAt` become nullable for impact rows only (a CHECK keeps them required on decision
 * rows). `PmAgentOutcomeRepository.recordDecisionWith` upserts on the new triple; its insert
 * relies on the column defaults to land on (cardId, 'decision', 0).
 */
export class PmAgentImpactOutcomes1982000000500 implements MigrationInterface {
  name = 'PmAgentImpactOutcomes1982000000500';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const t = '"pm_agent_outcomes"';
    await queryRunner.query(`
      ALTER TABLE ${t}
        ADD COLUMN IF NOT EXISTS "kind" varchar(16) NOT NULL DEFAULT 'decision',
        ADD COLUMN IF NOT EXISTS "day" smallint NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "metricRef" jsonb NULL,
        ADD COLUMN IF NOT EXISTS "windowFrom" date NULL,
        ADD COLUMN IF NOT EXISTS "windowTo" date NULL,
        ADD COLUMN IF NOT EXISTS "dueAt" timestamptz NULL,
        ADD COLUMN IF NOT EXISTS "readAt" timestamptz NULL,
        ADD COLUMN IF NOT EXISTS "value" double precision NULL,
        ADD COLUMN IF NOT EXISTS "baseline" double precision NULL,
        ADD COLUMN IF NOT EXISTS "sampleSize" integer NULL,
        ADD COLUMN IF NOT EXISTS "status" varchar(20) NULL,
        ADD COLUMN IF NOT EXISTS "verdict" varchar(16) NULL,
        ADD COLUMN IF NOT EXISTS "attempts" integer NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "lastError" varchar(300) NULL
    `);
    await queryRunner.query(
      `ALTER TABLE ${t} ALTER COLUMN "decision" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE ${t} ALTER COLUMN "decidedAt" DROP NOT NULL`,
    );

    await queryRunner.query(
      `ALTER TABLE ${t} DROP CONSTRAINT IF EXISTS "UQ_pm_agent_outcomes_card"`,
    );
    await queryRunner.query(
      `ALTER TABLE ${t} DROP CONSTRAINT IF EXISTS "UQ_pm_agent_outcomes_card_kind_day"`,
    );
    await queryRunner.query(
      `ALTER TABLE ${t} ADD CONSTRAINT "UQ_pm_agent_outcomes_card_kind_day" UNIQUE ("cardId", "kind", "day")`,
    );

    const checks: [string, string][] = [
      ['CHK_pm_agent_outcomes_kind', `"kind" IN ('decision', 'impact')`],
      [
        'CHK_pm_agent_outcomes_kind_day',
        `("kind" = 'decision' AND "day" = 0) OR ("kind" = 'impact' AND "day" IN (0, 14, 30))`,
      ],
      [
        'CHK_pm_agent_outcomes_decision_required',
        `"kind" <> 'decision' OR ("decision" IS NOT NULL AND "decidedAt" IS NOT NULL)`,
      ],
      [
        'CHK_pm_agent_outcomes_impact_status',
        `("kind" = 'decision' AND "status" IS NULL) OR ("kind" = 'impact' AND "status" IN ('pending', 'measured', 'insufficient_data', 'unavailable', 'not_measurable'))`,
      ],
      [
        'CHK_pm_agent_outcomes_verdict',
        `"verdict" IS NULL OR ("verdict" IN ('improved', 'flat', 'worse') AND "status" = 'measured')`,
      ],
      ['CHK_pm_agent_outcomes_attempts', `"attempts" >= 0`],
    ];
    for (const [name, expr] of checks) {
      await queryRunner.query(
        `ALTER TABLE ${t} DROP CONSTRAINT IF EXISTS "${name}"`,
      );
      await queryRunner.query(
        `ALTER TABLE ${t} ADD CONSTRAINT "${name}" CHECK (${expr})`,
      );
    }

    // The daily job's scan: pending impact rows that are due.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_pm_agent_outcomes_impact_due" ON ${t} ("dueAt") WHERE "kind" = 'impact' AND "status" = 'pending'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const t = '"pm_agent_outcomes"';
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_pm_agent_outcomes_impact_due"`,
    );
    for (const name of [
      'CHK_pm_agent_outcomes_attempts',
      'CHK_pm_agent_outcomes_verdict',
      'CHK_pm_agent_outcomes_impact_status',
      'CHK_pm_agent_outcomes_decision_required',
      'CHK_pm_agent_outcomes_kind_day',
      'CHK_pm_agent_outcomes_kind',
    ]) {
      await queryRunner.query(
        `ALTER TABLE ${t} DROP CONSTRAINT IF EXISTS "${name}"`,
      );
    }
    // Impact rows cannot exist under the one-row-per-card shape.
    await queryRunner.query(`DELETE FROM ${t} WHERE "kind" <> 'decision'`);
    await queryRunner.query(
      `ALTER TABLE ${t} DROP CONSTRAINT IF EXISTS "UQ_pm_agent_outcomes_card_kind_day"`,
    );
    await queryRunner.query(
      `ALTER TABLE ${t} ADD CONSTRAINT "UQ_pm_agent_outcomes_card" UNIQUE ("cardId")`,
    );
    await queryRunner.query(
      `ALTER TABLE ${t} ALTER COLUMN "decision" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE ${t} ALTER COLUMN "decidedAt" SET NOT NULL`,
    );
    await queryRunner.query(`
      ALTER TABLE ${t}
        DROP COLUMN IF EXISTS "lastError",
        DROP COLUMN IF EXISTS "attempts",
        DROP COLUMN IF EXISTS "verdict",
        DROP COLUMN IF EXISTS "status",
        DROP COLUMN IF EXISTS "sampleSize",
        DROP COLUMN IF EXISTS "baseline",
        DROP COLUMN IF EXISTS "value",
        DROP COLUMN IF EXISTS "readAt",
        DROP COLUMN IF EXISTS "dueAt",
        DROP COLUMN IF EXISTS "windowTo",
        DROP COLUMN IF EXISTS "windowFrom",
        DROP COLUMN IF EXISTS "metricRef",
        DROP COLUMN IF EXISTS "day",
        DROP COLUMN IF EXISTS "kind"
    `);
  }
}
