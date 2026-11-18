import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agents v2, chunk 20d: images on a bot's page (logo, cover, link preview, landing and team
 * photos). Each row is one checked, re-encoded image and its stored size variants. Removing one
 * detaches it; a daily sweep deletes the files 30 days later.
 */
export class CreateBotImages1981200000000 implements MigrationInterface {
  name = 'CreateBotImages1981200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "bot_images" ("createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), "id" uuid NOT NULL DEFAULT uuid_generate_v4(), "chatbot_id" uuid NOT NULL, "tenant_id" uuid, "kind" character varying(16) NOT NULL, "status" character varying(16) NOT NULL DEFAULT 'attached', "content_hash" character varying(64) NOT NULL, "width" integer NOT NULL, "height" integer NOT NULL, "variants" jsonb NOT NULL, "content_type" character varying(32) NOT NULL, "alt" character varying(300) NOT NULL DEFAULT '', "original_name" character varying(200) NOT NULL DEFAULT '', "created_by" integer, "detached_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_bot_images_id" PRIMARY KEY ("id"), CONSTRAINT "CHK_bot_images_kind" CHECK ("kind" IN ('logo', 'cover', 'share', 'landing', 'person')), CONSTRAINT "CHK_bot_images_status" CHECK ("status" IN ('attached', 'detached', 'purged')), CONSTRAINT "FK_bot_images_chatbot" FOREIGN KEY ("chatbot_id") REFERENCES "chatbots"("id") ON DELETE CASCADE)`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_bot_images_chatbot" ON "bot_images" ("chatbot_id", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_bot_images_detached" ON "bot_images" ("detached_at") WHERE "status" = 'detached'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "bot_images"`);
  }
}
