import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Builder's Rules: what a person decided once that binds future work.
 *
 * ## builder_rules
 *
 * One sentence (`statement`), a `scope` (everywhere / area:<name> / session:<id> /
 * opportunity:<id>) with its display `area`, and an `effect`: `guide` (read by the interview and
 * every run, outranking Builder's own lessons) or `decide` (answers decisions matching `match`
 * itself, recorded in builder_history with surface `rule`). Append-only by supersession: an edit
 * writes a new row with `supersedesId` and switches the old one off; `active` is the only column
 * that changes. How often a rule applied is the count of builder_history rows carrying its id.
 */
export class CreateBuilderRules1980800000000 implements MigrationInterface {
  name = 'CreateBuilderRules1980800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "builder_rules" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "statement" text NOT NULL,
        "scope" character varying(120) NOT NULL,
        "area" character varying(40) NOT NULL,
        "effect" character varying(8) NOT NULL DEFAULT 'guide',
        "match" jsonb,
        "sourceHistoryId" uuid,
        "supersedesId" uuid,
        "active" boolean NOT NULL DEFAULT true,
        "createdBy" integer NOT NULL,
        "updatedBy" integer,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_builder_rules_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_builder_rules_effect" CHECK ("effect" IN ('guide', 'decide')),
        CONSTRAINT "CHK_builder_rules_decide_match" CHECK ("effect" = 'guide' OR "match" IS NOT NULL),
        CONSTRAINT "CHK_builder_rules_match_object" CHECK ("match" IS NULL OR jsonb_typeof("match") = 'object')
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_builder_rules_active" ON "builder_rules" ("active")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_builder_history_rule" ON "builder_history" ("ruleId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_builder_history_rule"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "builder_rules"`);
  }
}
