import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Q3-fast Part 2: the agent keeps 8 passages per search, not 5.
 *
 * Since fix 1 the learned facts are searched too, as short passages, and with only 5 kept they
 * crowded out the page that held the answer (the customer-care phone, a possession date). The
 * platform's WhatsApp-bot settings row was seeded with `retrieval.maxPassages: 5`
 * (`1892000000008`), and that row wins over the code's default, so it moves here too: only where it
 * is still 5, so a value an admin chose stays. An assistant's own override is left alone.
 *
 * Data only. down() puts back 5 where this set 8.
 */
export class KeepEightPassages1984300000000 implements MigrationInterface {
  name = 'KeepEightPassages1984300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE global_settings
         SET value = jsonb_set(value, '{retrieval,maxPassages}', '8'::jsonb), "updatedAt" = now()
       WHERE name = 'whatsapp_bot'
         AND (value #>> '{retrieval,maxPassages}') = '5'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE global_settings
         SET value = jsonb_set(value, '{retrieval,maxPassages}', '5'::jsonb), "updatedAt" = now()
       WHERE name = 'whatsapp_bot'
         AND (value #>> '{retrieval,maxPassages}') = '8'`);
  }
}
