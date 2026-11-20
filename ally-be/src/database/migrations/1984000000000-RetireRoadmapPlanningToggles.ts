import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Retires the three per-admin toggles that overlapped the Roadmap roles:
 *
 *  - `product_planning_ideas`  -> the Idea role (Owner ⊃ Builder ⊃ Idea);
 *  - `product_planning_lead`   -> the Builder role;
 *  - `product_roadmap_quick_add` -> the Owner role.
 *
 * The role is read from `product_roadmap`, `builder` and `product_roadmap_manage`
 * (RoadmapRoleService), so the rows for the three retired keys are now dead
 * weight, and an unknown key in `admin_feature_toggles` is noise in every
 * "all toggles" read. This deletes them.
 *
 * It deliberately does NOT promote anyone. Moving a Lead or Quick Add holder up
 * to Builder or Owner would hand out merge or review rights as a side effect of a
 * cleanup, and an Owner sets roles on the Users screen. Instead it logs who held
 * a retired key without the role that now replaces it, so the Owner can
 * decide. (`product_planning_ideas` was on by default, and so was `product_roadmap`,
 * so every platform admin already holds the Idea role.)
 *
 * `down` cannot restore the rows: which holders had which key is gone with them.
 *
 * NOTE: FeatureToggleService caches enabled keys for 30 minutes and raw SQL cannot
 * bust it; a removed key simply stops being read, so nothing depends on that.
 */
const RETIRED: { key: string; needs: string[]; role: string }[] = [
  { key: 'product_planning_lead', needs: ['builder'], role: 'Builder' },
  {
    key: 'product_roadmap_quick_add',
    needs: ['product_roadmap_manage'],
    role: 'Owner',
  },
];

export class RetireRoadmapPlanningToggles1984000000000 implements MigrationInterface {
  name = 'RetireRoadmapPlanningToggles1984000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const { key, needs, role } of RETIRED) {
      const short: Array<{ userId: number }> = await queryRunner.query(
        `SELECT t."userId"
           FROM "admin_feature_toggles" t
          WHERE t."featureKey" = $1
            AND t."enabled" = true
            AND NOT EXISTS (
              SELECT 1 FROM "admin_feature_toggles" r
               WHERE r."userId" = t."userId"
                 AND r."featureKey" = ANY($2::character varying[])
                 AND r."enabled" = true
            )`,
        [key, needs],
      );
      if (short.length) {
        console.log(
          `[${this.name}] ${short.length} admin(s) held ${key} without the ${role} role it now needs: ` +
            JSON.stringify(short.map((row) => row.userId)),
        );
      }
    }

    await queryRunner.query(
      `DELETE FROM "admin_feature_toggles" WHERE "featureKey" = ANY($1::character varying[])`,
      [
        [
          'product_planning_ideas',
          'product_planning_lead',
          'product_roadmap_quick_add',
        ],
      ],
    );
  }

  public async down(): Promise<void> {
    // Not restorable: the per-admin rows are deleted, and the roles replace them.
  }
}
