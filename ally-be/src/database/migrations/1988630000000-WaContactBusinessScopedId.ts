import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * WA-A §4 (RC1 §4b): Meta's webhooks can carry a business-scoped user ID (`from_user_id`, e.g.
 * `IN.1349…`) instead of a phone number for people who adopt WhatsApp usernames. Such a message
 * is stored, matched and answered, never dropped: `wa_contacts.bsuid` holds the ID, and
 * `phone_e164` becomes nullable (a contact has a phone, an ID, or both). One contact per ID and
 * business number, as for phones. Nothing existing changes: every current row has a phone.
 */
export class WaContactBusinessScopedId1988630000000 implements MigrationInterface {
  name = 'WaContactBusinessScopedId1988630000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE wa_contacts ADD COLUMN IF NOT EXISTS bsuid varchar(140) NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE wa_contacts ALTER COLUMN phone_e164 DROP NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_contacts_bsuid ON wa_contacts (bsuid)
        WHERE business_number_id IS NULL AND bsuid IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_wa_contacts_bsuid_number
        ON wa_contacts (bsuid, business_number_id)
        WHERE business_number_id IS NOT NULL AND bsuid IS NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE wa_contacts ADD CONSTRAINT "CHK_wa_contacts_address"
        CHECK (phone_e164 IS NOT NULL OR bsuid IS NOT NULL)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE wa_contacts DROP CONSTRAINT IF EXISTS "CHK_wa_contacts_address"`,
    );
    // A contact known only by its ID keeps it in the phone column, so NOT NULL can come back.
    await queryRunner.query(
      `UPDATE wa_contacts SET phone_e164 = 'bsuid:' || bsuid WHERE phone_e164 IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE wa_contacts ALTER COLUMN phone_e164 SET NOT NULL`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS uq_wa_contacts_bsuid_number`);
    await queryRunner.query(`DROP INDEX IF EXISTS uq_wa_contacts_bsuid`);
    await queryRunner.query(
      `ALTER TABLE wa_contacts DROP COLUMN IF EXISTS bsuid`,
    );
  }
}
