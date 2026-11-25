import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * TF1 round 2 (Saathi B-4): existing Callback requests lists get what new ones have.
 * - The entry's title is the requester (their name, else their email), not the reason: on a
 *   health assistant the reason is never stored, so the card's headline fell back to the phone.
 * - An optional "Preferred day" (a date) for "tomorrow evening", before "Preferred time".
 * Additive: no entry is changed, and entries without a day still show as before.
 */
export class CallbackRequestsDayAndRequester1988300000000 implements MigrationInterface {
  name = 'CallbackRequestsDayAndRequester1988300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE collections
         SET settings = settings || '{"title_field": "requester"}'::jsonb,
             "updatedAt" = now()
       WHERE key = 'callback_requests' AND deleted_at IS NULL
         AND settings ->> 'title_field' = 'reason'
    `);
    await queryRunner.query(`
      UPDATE collection_fields f
         SET position = f.position + 1
        FROM collections c
       WHERE c.id = f.collection_id AND c.key = 'callback_requests' AND c.deleted_at IS NULL
         AND f.key IN ('preferred_time', 'status')
         AND NOT EXISTS (SELECT 1 FROM collection_fields d
                          WHERE d.collection_id = c.id AND d.key = 'preferred_day')
    `);
    await queryRunner.query(`
      INSERT INTO collection_fields
             (collection_id, key, label, type, options, required, privacy, agent_read, agent_write, position)
      SELECT c.id, 'preferred_day', 'Preferred day', 'date', '{}'::jsonb, false, '{}'::jsonb, true, true,
             coalesce((SELECT f.position FROM collection_fields f
                        WHERE f.collection_id = c.id AND f.key = 'preferred_time'), 4) - 1
        FROM collections c
       WHERE c.key = 'callback_requests' AND c.deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM collection_fields d
                          WHERE d.collection_id = c.id AND d.key = 'preferred_day')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM collection_fields f USING collections c
       WHERE c.id = f.collection_id AND c.key = 'callback_requests' AND f.key = 'preferred_day'
    `);
    await queryRunner.query(`
      UPDATE collection_fields f SET position = f.position - 1
        FROM collections c
       WHERE c.id = f.collection_id AND c.key = 'callback_requests'
         AND f.key IN ('preferred_time', 'status')
    `);
    await queryRunner.query(`
      UPDATE collections SET settings = settings || '{"title_field": "reason"}'::jsonb
       WHERE key = 'callback_requests' AND settings ->> 'title_field' = 'requester'
    `);
  }
}
