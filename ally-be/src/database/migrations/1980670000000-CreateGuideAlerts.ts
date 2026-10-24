import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `guide_alerts` (plans/ally-guide/plan.md §7.12, §13.4): each time an
 * alert rule fires — failures, the latency SLO, a cost anomaly, a crisis
 * spike, the anonymous cap, cache health. One row per rule per window
 * (`fingerprint`), so a rule that stays red does not repeat itself. Numbers
 * only; no learner or message appears.
 */
export class CreateGuideAlerts1980670000000 implements MigrationInterface {
  name = 'CreateGuideAlerts1980670000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "guide_alerts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "rule" character varying(48) NOT NULL,
        "severity" character varying(16) NOT NULL,
        "fingerprint" character varying(120) NOT NULL,
        "summary" character varying(500) NOT NULL,
        "value" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "notifiedAt" timestamp,
        "acknowledgedAt" timestamp,
        "acknowledgedBy" integer,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_guide_alerts_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_guide_alerts_fingerprint" UNIQUE ("fingerprint")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_guide_alerts_created" ON "guide_alerts" ("createdAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "guide_alerts"`);
  }
}
