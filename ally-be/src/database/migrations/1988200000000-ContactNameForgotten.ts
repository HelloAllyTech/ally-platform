import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * TF1 round 2 (Saathi B-2): "forget my name" removes the name an assistant keeps for a person.
 * `name_forgotten_at` stops the WhatsApp profile and list entries from filling it straight back;
 * the person giving their name again clears it. Nullable, no default: nothing changes for
 * existing contacts.
 */
export class ContactNameForgotten1988200000000 implements MigrationInterface {
  name = 'ContactNameForgotten1988200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE chatbot_contacts ADD COLUMN IF NOT EXISTS name_forgotten_at timestamp NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE chatbot_contacts DROP COLUMN IF EXISTS name_forgotten_at`,
    );
  }
}
