import { MigrationInterface, QueryRunner } from 'typeorm';
import { helplineLines } from '../../chatbot/engine/phone-text';

/**
 * TF1 round 2, S-1: a template's helpline answer was stored whole ("+91 20 4860 2525 (calls and
 * WhatsApp …). Open every day 10 am to 10 pm, …", cut at 200 characters) and, once confirmed,
 * went into every crisis reply. Crisis replies now read only the numbers; this stores only the
 * numbers too, so Settings shows exactly what a crisis reply gives.
 *
 * A value that changes goes back to waiting for the owner's confirmation (source `template`, not
 * confirmed): they confirmed the old text, so they confirm the cleaned number once more. Until
 * then crisis replies carry the national numbers only. A value with no number at all is removed.
 * The old value is kept under `helplineNumbersBeforeClean` for the way down.
 */
export class CleanHelplineNumbers1988150000000 implements MigrationInterface {
  name = 'CleanHelplineNumbers1988150000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const rows = (await queryRunner.query(`
      SELECT id, settings ->> 'helplineNumbers' AS numbers
        FROM chatbots
       WHERE coalesce(trim(settings ->> 'helplineNumbers'), '') <> ''
    `)) as { id: string; numbers: string }[];
    for (const row of rows) {
      const before = row.numbers.trim();
      const after = helplineLines(before);
      if (after === before) continue;
      await queryRunner.query(
        after
          ? `UPDATE chatbots
                SET settings = settings
                  || jsonb_build_object(
                       'helplineNumbers', $2::text,
                       'helplineNumbersBeforeClean', $3::text,
                       'helplineSource', 'template',
                       'helplineConfirmedAt', NULL)
              WHERE id = $1`
          : `UPDATE chatbots
                SET settings = (settings - 'helplineNumbers' - 'helplineSource' - 'helplineConfirmedAt')
                  || jsonb_build_object('helplineNumbersBeforeClean', $3::text)
              WHERE id = $1 AND $2::text = ''`,
        [row.id, after, before],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // The old text comes back, still waiting for a confirm: it is never put back into crisis
    // replies unconfirmed.
    await queryRunner.query(`
      UPDATE chatbots
         SET settings = (settings - 'helplineNumbersBeforeClean')
           || jsonb_build_object(
                'helplineNumbers', settings ->> 'helplineNumbersBeforeClean',
                'helplineSource', 'template',
                'helplineConfirmedAt', NULL)
       WHERE settings ? 'helplineNumbersBeforeClean'
    `);
  }
}
