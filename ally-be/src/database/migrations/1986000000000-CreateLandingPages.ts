import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Landing pages: public, admin-configured pages served at
 * `/<tenant code>/<slug>`, plus the three permissions that gate managing them.
 *
 *  - `landing_pages` — one row per page. `config` is the draft being edited,
 *    `published_config` the copy visitors see (null while unpublished).
 *    Unique per (tenant, slug) among rows that are not soft-deleted.
 *  - view:landing-pages / edit:landing-page / delete:landing-page — granted to
 *    the platform-tier groups only, the same idempotent grant as
 *    1830000000000-BlogPermissions. MULTI_TENANT_ADMIN is left out on purpose:
 *    a landing page is published to the whole internet.
 *
 * Group grants are written here once and never recomputed, and role lookups sit
 * behind a Redis cache a raw migration cannot clear, so an admin may need a
 * fresh sign-in (or the cache to expire) before the tab appears.
 */
const GROUPS = ['SUPER_ADMIN', 'SUPER_DUPER_ADMIN', 'PLATFORM_ADMIN'];

const PERMISSIONS = [
  'view:landing-pages',
  'edit:landing-page',
  'delete:landing-page',
];

export class CreateLandingPages1986000000000 implements MigrationInterface {
  name = 'CreateLandingPages1986000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "landing_pages" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "deletedAt" TIMESTAMP,
        "tenant_id" uuid NOT NULL,
        "name" character varying(160) NOT NULL,
        "slug" character varying(60) NOT NULL,
        "status" character varying(20) NOT NULL DEFAULT 'DRAFT',
        "config" jsonb NOT NULL,
        "published_config" jsonb,
        "published_at" TIMESTAMP,
        "created_by" integer NOT NULL,
        "updated_by" integer NOT NULL,
        CONSTRAINT "PK_landing_pages" PRIMARY KEY ("id"),
        CONSTRAINT "FK_landing_pages_tenant" FOREIGN KEY ("tenant_id")
          REFERENCES "tenants" ("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_landing_pages_status" CHECK ("status" IN ('DRAFT','PUBLISHED')),
        CONSTRAINT "CHK_landing_pages_slug" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
        CONSTRAINT "CHK_landing_pages_published_config" CHECK (
          "status" <> 'PUBLISHED' OR "published_config" IS NOT NULL
        )
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_landing_pages_tenant_slug_idx" ON "landing_pages" ("tenant_id", "slug") WHERE "deletedAt" IS NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_landing_pages_tenant_idx" ON "landing_pages" ("tenant_id")`,
    );

    for (const name of PERMISSIONS) {
      const existing = await queryRunner.query(
        `SELECT id FROM "permissions" WHERE name = $1`,
        [name],
      );
      if (existing.length === 0) {
        await queryRunner.query(
          `INSERT INTO "permissions" (name) VALUES ($1)`,
          [name],
        );
      }
    }

    for (const groupName of GROUPS) {
      const group = await queryRunner.query(
        `SELECT id FROM "groups" WHERE name = $1 LIMIT 1`,
        [groupName],
      );
      const groupId = group?.[0]?.id;
      // A group that does not exist in this environment is skipped.
      if (!groupId) continue;
      for (const name of PERMISSIONS) {
        const perm = await queryRunner.query(
          `SELECT id FROM "permissions" WHERE name = $1 LIMIT 1`,
          [name],
        );
        const permId = perm?.[0]?.id;
        if (!permId) continue;
        const grant = await queryRunner.query(
          `SELECT id FROM group_permissions WHERE "groupId" = $1 AND "permissionId" = $2`,
          [groupId, permId],
        );
        if (grant.length === 0) {
          await queryRunner.query(
            `INSERT INTO group_permissions ("groupId", "permissionId") VALUES ($1, $2)`,
            [groupId, permId],
          );
        }
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const groupName of GROUPS) {
      for (const name of PERMISSIONS) {
        await queryRunner.query(
          `DELETE FROM group_permissions
             WHERE "groupId" = (SELECT id FROM "groups" WHERE name = $1 LIMIT 1)
               AND "permissionId" = (SELECT id FROM "permissions" WHERE name = $2)`,
          [groupName, name],
        );
      }
    }
    await queryRunner.query(
      `DELETE FROM "permissions"
         WHERE name IN ($1, $2, $3)
           AND id NOT IN (SELECT DISTINCT "permissionId" FROM group_permissions)`,
      PERMISSIONS,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "landing_pages"`);
  }
}
