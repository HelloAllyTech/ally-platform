import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Stage 1b — the responder agreement, stored per person and version. One row per acceptance;
 * accepting the same version twice keeps the first. The current version is a constant in code
 * (RESPONDER_AGREEMENT_VERSION).
 */
export class CreateResponderAgreements1986540000200 implements MigrationInterface {
  name = 'CreateResponderAgreements1986540000200';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "responder_agreements" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" integer NOT NULL,
        "version" character varying(16) NOT NULL,
        "accepted_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "ip" character varying(64),
        CONSTRAINT "PK_responder_agreements_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_responder_agreements_user_version"
         ON "responder_agreements" ("user_id", "version")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "responder_agreements"`);
  }
}
