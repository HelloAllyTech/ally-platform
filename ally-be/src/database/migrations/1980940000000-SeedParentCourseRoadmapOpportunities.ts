import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  FALLBACK_GOAL,
  PARENT_COURSE_ADMIN_EMAIL,
  PARENT_COURSE_CODE,
  PARENT_COURSE_OPPORTUNITIES,
  descriptionOf,
  prdOf,
} from '../seed-data/parent-course-roadmap-opportunities.data';

/**
 * Logs the PARENT_COURSE batch of roadmap opportunities. The data lives in
 * `../seed-data/parent-course-roadmap-opportunities.data.ts`: TypeORM treats every export of a migration file
 * as a migration class, so a migration may export only its class.
 */
export class SeedParentCourseRoadmapOpportunities1980940000000 implements MigrationInterface {
  name = 'SeedParentCourseRoadmapOpportunities1980940000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const users: Array<{ id: number }> = await queryRunner.query(
      `SELECT "id" FROM "users" WHERE lower("email") = lower($1) LIMIT 1`,
      [PARENT_COURSE_ADMIN_EMAIL],
    );
    if (users.length === 0) {
      console.warn(
        `[${this.name}] user ${PARENT_COURSE_ADMIN_EMAIL} not found; ${PARENT_COURSE_CODE} opportunities NOT seeded`,
      );
      return;
    }
    const userId = users[0].id;

    const goalRows: Array<{ name: string }> = await queryRunner.query(
      `SELECT "name" FROM "roadmap_product_goals" ORDER BY "position" ASC`,
    );
    if (goalRows.length === 0) {
      console.warn(
        `[${this.name}] no product goals exist; ${PARENT_COURSE_CODE} opportunities NOT seeded`,
      );
      return;
    }
    const goals = new Set(goalRows.map((g) => g.name));
    // Goals are renameable in the admin UI and the FK is by name, so fall back rather than abort.
    const fallback = goals.has(FALLBACK_GOAL)
      ? FALLBACK_GOAL
      : goalRows[0].name;

    for (const o of PARENT_COURSE_OPPORTUNITIES) {
      const goal = goals.has(o.goal) ? o.goal : fallback;
      await queryRunner.query(
        `INSERT INTO "roadmap_opportunities"
           ("description", "type", "stage", "productGoal", "prd", "effort", "createdBy", "updatedBy")
         SELECT $1, 'idea', 'new', $2, $3, $4, $5, $5
          WHERE NOT EXISTS (
            SELECT 1 FROM "roadmap_opportunities"
             WHERE "description" = $1 AND "deletedAt" IS NULL
          )`,
        [descriptionOf(o), goal, prdOf(o), o.effort, userId],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove only rows still exactly as seeded: no votes, no comments. Anything people have
    // engaged with stays.
    for (const o of PARENT_COURSE_OPPORTUNITIES) {
      await queryRunner.query(
        `DELETE FROM "roadmap_opportunities" r
          WHERE r."description" = $1
            AND r."stage" = 'new'
            AND NOT EXISTS (SELECT 1 FROM "roadmap_allocations" a WHERE a."opportunityId" = r."id")
            AND NOT EXISTS (SELECT 1 FROM "roadmap_opportunity_comments" c WHERE c."opportunityId" = r."id")`,
        [descriptionOf(o)],
      );
    }
  }
}
