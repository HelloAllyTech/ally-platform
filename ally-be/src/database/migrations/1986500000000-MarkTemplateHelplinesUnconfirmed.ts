import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Q4 G7: crisis replies carry only helpline numbers the owner confirmed in Safety. A number a
 * template wrote (T1's Helpline and Mental-health practice templates ask for one) is marked as the
 * template's, so crisis replies leave it out until the owner confirms it; Round 7 S2 found a number
 * that wasn't on the organisation's pages added to its crisis reply. Numbers saved any other way
 * have no source and stay as they are (they count as the owner's).
 *
 * Settings only (jsonb keys), no schema change. Down removes the marker, which makes those numbers
 * count as the owner's again.
 */
export class MarkTemplateHelplinesUnconfirmed1986500000000 implements MigrationInterface {
  name = 'MarkTemplateHelplinesUnconfirmed1986500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE chatbots
         SET settings = settings || '{"helplineSource": "template"}'::jsonb
       WHERE id IN (
               SELECT chatbot_id FROM chatbot_template_installs
                WHERE template_id IN ('helpline', 'practice')
             )
         AND coalesce(trim(settings ->> 'helplineNumbers'), '') <> ''
         AND NOT (settings ? 'helplineSource')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE chatbots
         SET settings = settings - 'helplineSource' - 'helplineConfirmedAt'
       WHERE settings ->> 'helplineSource' = 'template'
    `);
  }
}
