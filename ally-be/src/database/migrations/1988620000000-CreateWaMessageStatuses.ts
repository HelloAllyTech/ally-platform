import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * WA-A §3: Meta's delivery status for each outgoing WhatsApp message (sent, delivered, read, or
 * failed with its reason), keyed by Meta's message id. Kept apart from `wa_messages` on purpose:
 * any sender (a reply, a team reply, and WA-C's campaign sends) can read delivered and read by the
 * id Meta returned, whether or not it writes a `wa_messages` row. The latest state only; each
 * time is set once. Gone with the conversation's retention like the messages it describes.
 */
export class CreateWaMessageStatuses1988620000000 implements MigrationInterface {
  name = 'CreateWaMessageStatuses1988620000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS wa_message_statuses (
        provider_message_id varchar(128) PRIMARY KEY,
        status varchar(16) NOT NULL,
        recipient varchar(128) NULL,
        sent_at timestamp NULL,
        delivered_at timestamp NULL,
        read_at timestamp NULL,
        failed_at timestamp NULL,
        error_code integer NULL,
        error_title varchar(256) NULL,
        error_detail varchar(512) NULL,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_wa_message_statuses_updated ON wa_message_statuses ("updatedAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS wa_message_statuses`);
  }
}
