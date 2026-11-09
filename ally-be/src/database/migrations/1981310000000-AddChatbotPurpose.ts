import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agents v2, chunk 20a-2: what an assistant is for. `purpose` is one of five (answer, enquiries,
 * training, guide, custom); `purpose_note` is the owner's own description for "Something else".
 * Null for every existing bot, which runs exactly as before.
 */
export class AddChatbotPurpose1981310000000 implements MigrationInterface {
  name = 'AddChatbotPurpose1981310000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "chatbots" ADD "purpose" character varying(16), ADD "purpose_note" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "chatbots" ADD CONSTRAINT "CHK_chatbots_purpose" CHECK ("purpose" IS NULL OR "purpose" IN ('answer', 'enquiries', 'training', 'guide', 'custom'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "chatbots" DROP CONSTRAINT "CHK_chatbots_purpose"`,
    );
    await queryRunner.query(
      `ALTER TABLE "chatbots" DROP COLUMN "purpose_note", DROP COLUMN "purpose"`,
    );
  }
}
