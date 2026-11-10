import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Product planning P8 (plans/roadmap-owns-planning rev 5.2 decision 11): the Context Library's
 * **Product Outcomes** collection (`product_outcomes`, `PO-`), written by the roadmap's outcome
 * reviewer, and its default grants. Its profile is
 * `src/context-library/profiles/product-outcomes.profile.ts`.
 *
 * Granted to the readers that set a plan's target: the Builder PRD interview and research
 * passes, the PRD reviewer, the roadmap copilot, and engineers' `mcp_dev`. `admin_preview` and
 * `eval` read every collection by default and get no row.
 */
const GRANTS = [
  'builder_interview',
  'builder_research',
  'builder_prd_review',
  'builder_brief',
  'roadmap_copilot',
  'mcp_dev',
];

export class AddProductOutcomesCollection1981900300000 implements MigrationInterface {
  name = 'AddProductOutcomesCollection1981900300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "cl_collections" ("id", "name", "code_prefix") VALUES ($1, $2, $3)
       ON CONFLICT ("id") DO NOTHING`,
      ['product_outcomes', 'Product Outcomes', 'PO'],
    );
    for (const useCase of GRANTS) {
      await queryRunner.query(
        `INSERT INTO "cl_use_case_access" ("use_case", "collection_id", "enabled", "weight")
         VALUES ($1, 'product_outcomes', true, 1)
         ON CONFLICT ("use_case", "collection_id") DO NOTHING`,
        [useCase],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "cl_use_case_access" WHERE "collection_id" = 'product_outcomes'`,
    );
    await queryRunner.query(
      `DELETE FROM "cl_collections" WHERE "id" = 'product_outcomes'
         AND NOT EXISTS (SELECT 1 FROM "cl_chunks" WHERE "collection_id" = 'product_outcomes')`,
    );
  }
}
