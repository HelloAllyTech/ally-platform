import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Release tracking for roadmap opportunities (Roadmap v2, phase P1).
 *
 *  - `item_linked_prs`: the pull requests that deliver an opportunity — from
 *    its Builder session, from its code in a PR title or branch, or linked by
 *    hand ("Built elsewhere").
 *  - `item_releases`: per merged pull request and touched service, whether a
 *    successful production release contains the merge commit.
 *
 * Additive only: two new tables, nothing existing is altered. Released is
 * decided from these by `ItemReleaseService`, which replaces the old reliance
 * on `builder_pull_requests.releaseState`.
 *
 * Both key on the full repo ("owner/name") beside the pull request number,
 * because numbers restarted at #1 in the monorepo.
 */
export class CreateItemReleaseTracking1983100000000 implements MigrationInterface {
  name = 'CreateItemReleaseTracking1983100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "item_linked_prs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "opportunityId" uuid NOT NULL,
        "repo" character varying(120) NOT NULL,
        "prNumber" integer NOT NULL,
        "prUrl" text,
        "source" character varying(12) NOT NULL,
        "state" character varying(12) NOT NULL DEFAULT 'open',
        "title" text,
        "branch" character varying(255),
        "mergeSha" character varying(64),
        "mergedAt" TIMESTAMP,
        "servicesResolvedAt" TIMESTAMP,
        "createdBy" integer,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_item_linked_prs" PRIMARY KEY ("id"),
        CONSTRAINT "FK_item_linked_prs_opportunity" FOREIGN KEY ("opportunityId")
          REFERENCES "roadmap_opportunities"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_item_linked_prs_source" CHECK ("source" IN ('builder', 'code_match', 'manual')),
        CONSTRAINT "CHK_item_linked_prs_state" CHECK ("state" IN ('open', 'merged', 'closed')),
        CONSTRAINT "CHK_item_linked_prs_pr_number" CHECK ("prNumber" > 0)
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_item_linked_prs_opp_repo_pr" ON "item_linked_prs" ("opportunityId", "repo", "prNumber")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "item_releases" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "opportunityId" uuid NOT NULL,
        "repo" character varying(120) NOT NULL,
        "prNumber" integer NOT NULL,
        "service" character varying(12) NOT NULL,
        "apps" character varying(10),
        "mergeSha" character varying(64) NOT NULL,
        "mergedAt" TIMESTAMP,
        "tag" character varying(80),
        "releasedAt" TIMESTAMP,
        "state" character varying(10) NOT NULL DEFAULT 'pending',
        "checkedRef" character varying(200),
        "lastCheckedAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_item_releases" PRIMARY KEY ("id"),
        CONSTRAINT "FK_item_releases_opportunity" FOREIGN KEY ("opportunityId")
          REFERENCES "roadmap_opportunities"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_item_releases_state" CHECK ("state" IN ('pending', 'live', 'failed')),
        CONSTRAINT "CHK_item_releases_service" CHECK ("service" IN ('be', 'ai', 'learn', 'frontend', 'mobile', 'none')),
        CONSTRAINT "CHK_item_releases_apps" CHECK ("apps" IS NULL OR "apps" IN ('admin', 'helpline', 'both'))
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_item_releases_opp_repo_pr_service" ON "item_releases" ("opportunityId", "repo", "prNumber", "service")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_item_releases_state" ON "item_releases" ("state")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "item_releases"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "item_linked_prs"`);
  }
}
