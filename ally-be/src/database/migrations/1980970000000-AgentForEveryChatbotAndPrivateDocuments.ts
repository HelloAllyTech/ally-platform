import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Agents v2, chunk 3d.
 *
 * - Every chatbot answers with v2 and the conversational agent. Existing bots (v1 or shadow) move
 *   to v2 with `features.agent` on, and new bots get the same by default. The columns stay: the
 *   engine reads only the platform switch now, and a later chunk deletes v1 with them.
 * - `kb_documents.owner_chatbot_id`: a document uploaded on a chatbot's Knowledge tab belongs to
 *   that chatbot. Null is a shared library document (every existing one). Ownership decides who
 *   sees and manages a document; `chatbot_documents` still decides what a bot answers from.
 *
 * `down` restores the column defaults and drops ownership. It can't know which bots were on v1 or
 * shadow before, so they stay on v2 with Agent mode, which the chunk 3a code also handles.
 */
export class AgentForEveryChatbotAndPrivateDocuments1980970000000 implements MigrationInterface {
  name = 'AgentForEveryChatbotAndPrivateDocuments1980970000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "chatbots" SET "runtime" = 'v2', "features" = "features" || '{"agent": true}'::jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "chatbots" ALTER COLUMN "runtime" SET DEFAULT 'v2'`,
    );
    await queryRunner.query(
      `ALTER TABLE "chatbots" ALTER COLUMN "features" SET DEFAULT '{"agent": true}'`,
    );

    await queryRunner.query(
      `ALTER TABLE "kb_documents" ADD "owner_chatbot_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "kb_documents" ADD CONSTRAINT "FK_kb_documents_owner_chatbot" FOREIGN KEY ("owner_chatbot_id") REFERENCES "chatbots"("id") ON DELETE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_kb_documents_corpus_owner_chatbot" ON "kb_documents" ("corpus", "owner_chatbot_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "idx_kb_documents_corpus_owner_chatbot"`,
    );
    await queryRunner.query(
      `ALTER TABLE "kb_documents" DROP CONSTRAINT "FK_kb_documents_owner_chatbot"`,
    );
    await queryRunner.query(
      `ALTER TABLE "kb_documents" DROP COLUMN "owner_chatbot_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "chatbots" ALTER COLUMN "features" SET DEFAULT '{}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "chatbots" ALTER COLUMN "runtime" SET DEFAULT 'v1'`,
    );
  }
}
