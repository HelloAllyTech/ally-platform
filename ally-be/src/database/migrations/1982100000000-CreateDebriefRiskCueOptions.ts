import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Risk-cue options (spec DEBRIEF_ACROSS_ROLEPLAYS §5–6): what a roleplay's Debrief counts as a
 * risk cue and how it handles one, chosen per roleplay in Simulation Studio
 * (`scenarios.metadata.debriefRiskCueOption`, an option's `key`; absent = Standard).
 *
 * An option's `wording` is the risk-cue definition the prompts read through `{{risk_cue_definition}}`;
 * NULL means "the pinned definition" (the Skills Store's `debrief_risk_cue_definition`), which is
 * what the two seeded options use, so nothing changes for any roleplay and one text stays the
 * source of truth. Its behaviour is chosen from a fixed set that code implements: `handling`,
 * `wordListRaises`, `supportLinesOnCue`.
 *
 * `status`: draft (its creator's), awaiting_approval (a clinical advisor decides), approved
 * (selectable by every roleplay) or retired (no new roleplay may pick it; ones using it keep it).
 */
export class CreateDebriefRiskCueOptions1982100000000 implements MigrationInterface {
  name = 'CreateDebriefRiskCueOptions1982100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "debrief_risk_cue_options" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "key" character varying(60) NOT NULL,
        "name" character varying(120) NOT NULL,
        "description" text,
        "wording" text,
        "handling" character varying(12) NOT NULL DEFAULT 'alarm',
        "wordListRaises" boolean NOT NULL DEFAULT true,
        "supportLinesOnCue" boolean NOT NULL DEFAULT true,
        "examples" jsonb NOT NULL DEFAULT '{"cues":[],"nonCues":[]}'::jsonb,
        "status" character varying(20) NOT NULL DEFAULT 'draft',
        "version" integer NOT NULL DEFAULT 1,
        "testResult" jsonb,
        "history" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "reviewNote" text,
        "createdBy" integer,
        "approvedBy" integer,
        "approvedAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_debrief_risk_cue_options" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_debrief_risk_cue_options_key" UNIQUE ("key"),
        CONSTRAINT "CHK_debrief_risk_cue_options_handling"
          CHECK ("handling" IN ('alarm', 'assessed')),
        CONSTRAINT "CHK_debrief_risk_cue_options_status"
          CHECK ("status" IN ('draft', 'awaiting_approval', 'approved', 'retired'))
      )
    `);
    await queryRunner.query(
      `INSERT INTO "debrief_risk_cue_options"
         ("key", "name", "description", "wording", "handling", "wordListRaises", "supportLinesOnCue", "status", "approvedAt")
       VALUES
         ('standard', 'Standard',
          'Counselling roleplays: a risk cue is an alarm. It gets an important moment, and the support lines show.',
          NULL, 'alarm', true, true, 'approved', now()),
         ('part_of_practice', 'Part of the practice',
          'The risk cue is the skill being practised (for example suicide prevention). The reader decides, cue by cue, which cues are that skill: those are still detected and never lowered, and are assessed in the coaching cards with no alarm card. Any other cue is still an alarm.',
          NULL, 'assessed', true, true, 'approved', now())
       ON CONFLICT ("key") DO NOTHING`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "debrief_risk_cue_options"`);
  }
}
