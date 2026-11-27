import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Retires the EVALUATOR consumer-app role (see CreateEvaluatorRole1968000000000)
 * and its single permission, `evaluator:access`.
 *
 * The in-app evaluation feature the role was created for was dropped and no
 * screen gates on the permission any more. This is NOT the AI Lab evaluator
 * portal: that uses the separate `lab_evaluators` table and is untouched.
 *
 * `up` removes the role completely: the `user_groups` rows that assign it, its
 * `group_permissions` rows, the permission itself, then the group.
 *
 * Holders: in prod seven users hold the role. Four of them keep another app
 * role; three hold nothing else and end up role-less ON PURPOSE (dormant test
 * accounts, suspended separately). Nothing here reassigns them.
 *
 * NOTE: permissions are cached in Redis (`group:permissions:*`,
 * `user:groups:*`, `user:roles:*`, 30-minute TTL) and a raw SQL migration
 * cannot bust them. For up to 30 minutes after deploy a former holder's cached
 * role list may still contain EVALUATOR; nothing reads it, so that is harmless.
 *
 * `down` recreates the group, the permission and the link between them. The
 * former holders are not restored (there is no record of them once the
 * `user_groups` rows are gone).
 */
const EVALUATOR_GROUP = 'EVALUATOR';
const EVALUATOR_ACCESS = 'evaluator:access';

export class RetireEvaluatorRole1989200000000 implements MigrationInterface {
  name = 'RetireEvaluatorRole1989200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "user_groups"
       WHERE "groupId" IN (SELECT id FROM "groups" WHERE name = $1)`,
      [EVALUATOR_GROUP],
    );

    await queryRunner.query(
      `DELETE FROM "group_permissions"
       WHERE "groupId" IN (SELECT id FROM "groups" WHERE name = $1)
          OR "permissionId" IN (SELECT id FROM "permissions" WHERE name = $2)`,
      [EVALUATOR_GROUP, EVALUATOR_ACCESS],
    );

    await queryRunner.query(`DELETE FROM "permissions" WHERE name = $1`, [
      EVALUATOR_ACCESS,
    ]);

    await queryRunner.query(`DELETE FROM "groups" WHERE name = $1`, [
      EVALUATOR_GROUP,
    ]);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // `$1::varchar` rather than a bare `$1`: in `SELECT $1` Postgres has no
    // column to infer the parameter type from and rejects text vs varchar.
    await queryRunner.query(
      `INSERT INTO "groups" ("name")
       SELECT $1::varchar
       WHERE NOT EXISTS (SELECT 1 FROM "groups" WHERE name = $1::varchar)`,
      [EVALUATOR_GROUP],
    );

    await queryRunner.query(
      `INSERT INTO "permissions" ("name")
       SELECT $1::varchar
       WHERE NOT EXISTS (SELECT 1 FROM "permissions" WHERE name = $1::varchar)`,
      [EVALUATOR_ACCESS],
    );

    await queryRunner.query(
      `INSERT INTO "group_permissions" ("groupId", "permissionId")
       SELECT g.id, p.id
       FROM "groups" g
       JOIN "permissions" p ON p.name = $2
       WHERE g.name = $1
         AND NOT EXISTS (
           SELECT 1 FROM "group_permissions" existing
           WHERE existing."groupId" = g.id
             AND existing."permissionId" = p.id
         )`,
      [EVALUATOR_GROUP, EVALUATOR_ACCESS],
    );
  }
}
