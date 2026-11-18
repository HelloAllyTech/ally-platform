import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * When a chatbot was last tried in Preview. Preview stores no messages, so without this the
 * setup checklist cannot tell that someone has tested the bot.
 */
export class AddChatbotLastTestedAt1980920000000 implements MigrationInterface {
  name = 'AddChatbotLastTestedAt1980920000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "chatbots" ADD "last_tested_at" TIMESTAMP`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "chatbots" DROP COLUMN "last_tested_at"`,
    );
  }
}
