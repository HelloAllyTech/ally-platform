import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Assistants admin → Templates: use-case templates staff can build, version and publish.
 *
 * The 17 built-in templates stay in code (`chatbot/templates/templates.ts`). A row here is one
 * *version* of a template: a draft staff are editing, the published one the catalogue serves
 * (it replaces a built-in of the same key, or adds a new template), or an older, retired one kept
 * for history and restore. At most one version per key is published at a time. A published
 * version's manifest is immutable; changing it means a new draft.
 *
 * Installs already record the template id (`chatbot_template_installs.template_id`); a managed
 * template also records its version there, so "which wording did this assistant start from" is
 * answerable after the template changes.
 */
export class CreateAssistantTemplates1988100000000 implements MigrationInterface {
  name = 'CreateAssistantTemplates1988100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "assistant_templates" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "template_key" varchar(40) NOT NULL,
        "version" integer NOT NULL,
        "status" varchar(12) NOT NULL DEFAULT 'draft',
        "manifest" jsonb NOT NULL,
        "note" text,
        "created_by" integer,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "published_by" integer,
        "published_at" timestamptz,
        "retired_at" timestamptz,
        CONSTRAINT "PK_assistant_templates" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_assistant_templates_key_version" UNIQUE ("template_key", "version"),
        CONSTRAINT "CHK_assistant_templates_status"
          CHECK ("status" IN ('draft', 'published', 'retired'))
      )
    `);
    // One live version per template, and one open draft per template.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_assistant_templates_published"
        ON "assistant_templates" ("template_key") WHERE "status" = 'published'
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_assistant_templates_draft"
        ON "assistant_templates" ("template_key") WHERE "status" = 'draft'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "assistant_templates"`);
  }
}
