import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Use-case templates (Agents v2, T1): where an assistant came from. One row each time a template
 * is installed on an assistant, in setup or from Tools, with the owner's setup answers and what was
 * left as it was. The templates themselves are definitions in code (`chatbot/templates/`), so this
 * holds only the template's id.
 */
export class CreateChatbotTemplateInstalls1985800000000 implements MigrationInterface {
  name = 'CreateChatbotTemplateInstalls1985800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "chatbot_template_installs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "chatbot_id" uuid NOT NULL,
        "template_id" varchar(40) NOT NULL,
        "setup_answers" jsonb NOT NULL DEFAULT '{}',
        "added" jsonb NOT NULL DEFAULT '[]',
        "skipped" jsonb NOT NULL DEFAULT '[]',
        "installed_by" integer,
        "installed_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_chatbot_template_installs" PRIMARY KEY ("id"),
        CONSTRAINT "FK_chatbot_template_installs_chatbot" FOREIGN KEY ("chatbot_id")
          REFERENCES "chatbots"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_chatbot_template_installs_chatbot"
        ON "chatbot_template_installs" ("chatbot_id", "installed_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "chatbot_template_installs"`);
  }
}
