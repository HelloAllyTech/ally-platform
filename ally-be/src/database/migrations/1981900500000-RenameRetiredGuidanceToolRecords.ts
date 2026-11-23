import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Stored records that still name the product-guidance tools the Context Library replaced on
 * 2026-11-09 now name the `principles_*` tools that replaced them, so no code has to keep reading
 * the old names:
 *  - `roadmap_opportunities.brief`: evidence filed under the old source becomes `principles`;
 *  - `builder_messages`: tool calls and results recorded under the old tool names;
 *  - `builder_evidence`: the evidence log's tool name and the prefix of its source label.
 *
 * Order within each array is kept (`WITH ORDINALITY`). Hand-written SQL. Not reversed: nothing
 * reads the old names any more.
 */
export class RenameRetiredGuidanceToolRecords1981900500000 implements MigrationInterface {
  name = 'RenameRetiredGuidanceToolRecords1981900500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "roadmap_opportunities" o
          SET "brief" = jsonb_set(o."brief", '{evidence}', (
            SELECT jsonb_agg(
              CASE WHEN e.item->>'source' = 'stacks'
                   THEN jsonb_set(e.item, '{source}', '"principles"')
                   ELSE e.item END
              ORDER BY e.ord)
              FROM jsonb_array_elements(o."brief"->'evidence') WITH ORDINALITY AS e(item, ord)
          ))
        WHERE jsonb_typeof(o."brief"->'evidence') = 'array'
          AND o."brief"->'evidence' @> '[{"source": "stacks"}]'`,
    );

    for (const column of ['toolCalls', 'toolResults']) {
      await queryRunner.query(
        `UPDATE "builder_messages" m
            SET "${column}" = (
              SELECT jsonb_agg(
                CASE WHEN c.item->>'name' IN ('stacks_search', 'stacks_get')
                     THEN jsonb_set(c.item, '{name}',
                       to_jsonb(replace(c.item->>'name', 'stacks_', 'principles_')))
                     ELSE c.item END
                ORDER BY c.ord)
                FROM jsonb_array_elements(m."${column}") WITH ORDINALITY AS c(item, ord)
            )
          WHERE jsonb_typeof(m."${column}") = 'array'
            AND (m."${column}" @> '[{"name": "stacks_search"}]'
              OR m."${column}" @> '[{"name": "stacks_get"}]')`,
      );
    }

    await queryRunner.query(
      `UPDATE "builder_evidence"
          SET "tool" = replace("tool", 'stacks_', 'principles_'),
              "source" = regexp_replace("source", '^stacks:', 'principles:')
        WHERE "tool" IN ('stacks_search', 'stacks_get')`,
    );
  }

  public async down(): Promise<void> {
    // Not reversed: see the class comment.
  }
}
