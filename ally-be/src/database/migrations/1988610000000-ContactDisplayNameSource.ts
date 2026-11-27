import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * WA-A §0b (TF1 "Still open"): where a contact's `display_name` came from, so a name the person
 * gives in the chat ("I'm Bilal") replaces their WhatsApp profile name ("B."), while a name they
 * gave is never overwritten by the profile. `whatsapp_profile` or `chat`; null for names set
 * before this column (treated as given, so nothing existing is replaced).
 */
export class ContactDisplayNameSource1988610000000 implements MigrationInterface {
  name = 'ContactDisplayNameSource1988610000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE chatbot_contacts ADD COLUMN IF NOT EXISTS display_name_source varchar(16) NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE chatbot_contacts DROP COLUMN IF EXISTS display_name_source`,
    );
  }
}
