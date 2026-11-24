import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * What a person did with an insight on For you (Statistics): marked it done, or
 * asked to be reminded later. Per person: one admin finishing a finding does not
 * hide it from another. The fingerprint names the finding and the week it was
 * found in, so a finding that is still true next week comes back.
 */
export class CreateStatisticsInsightState1987900000000 implements MigrationInterface {
  name = 'CreateStatisticsInsightState1987900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "statistics_insight_state" (` +
        `"id" uuid NOT NULL DEFAULT uuid_generate_v4(), ` +
        `"tenantId" uuid NOT NULL, ` +
        `"userId" integer NOT NULL, ` +
        `"fingerprint" character varying(200) NOT NULL, ` +
        `"state" character varying(16) NOT NULL, ` +
        `"until" TIMESTAMP, ` +
        `"createdAt" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `"updatedAt" TIMESTAMP NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "PK_statistics_insight_state_id" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_statistics_insight_state_user_fingerprint" ` +
        `ON "statistics_insight_state" ("userId", "fingerprint")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_statistics_insight_state_tenant" ` +
        `ON "statistics_insight_state" ("tenantId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."idx_statistics_insight_state_tenant"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."idx_statistics_insight_state_user_fingerprint"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "statistics_insight_state"`);
  }
}
