import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A roleplay interview's tenant id is text, as on course_copilot_sessions: the
 * platform's own tenant id is "ally", not a uuid, so a uuid column refused every
 * interview a platform admin started ("invalid input syntax for type uuid").
 */
export class RoleplayInterviewTenantIdText1987800000000
  implements MigrationInterface
{
  name = 'RoleplayInterviewTenantIdText1987800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "roleplay_interview_sessions" ` +
        `ALTER COLUMN "tenantId" TYPE character varying USING "tenantId"::text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Values that are not uuids (such as "ally") cannot go back; clear them.
    await queryRunner.query(
      `ALTER TABLE "roleplay_interview_sessions" ` +
        `ALTER COLUMN "tenantId" TYPE uuid USING (CASE WHEN "tenantId" ~* ` +
        `'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' ` +
        `THEN "tenantId"::uuid END)`,
    );
  }
}
