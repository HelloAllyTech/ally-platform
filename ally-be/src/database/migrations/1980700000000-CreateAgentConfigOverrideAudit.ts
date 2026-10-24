import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `agent_config_override_audit` (plans/ally-guide/plan.md §7.5): the org- and
 * course-layer overrides in `agent_config_overrides` are audited — one row per
 * key changed, with who, when, the old value and the new one. Append-only.
 *
 * Values are wrapped as `{ "value": … }` so "set to null" (a legal value,
 * e.g. side quests off) stays distinct from "not set" (a NULL column).
 */
export class CreateAgentConfigOverrideAudit1980700000000 implements MigrationInterface {
  name = 'CreateAgentConfigOverrideAudit1980700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "agent_config_override_audit" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "agentKey" character varying(64) NOT NULL,
        "layer" character varying(16) NOT NULL,
        "scopeId" character varying(64) NOT NULL,
        "key" character varying(128) NOT NULL,
        "oldValue" jsonb,
        "newValue" jsonb,
        "version" integer NOT NULL,
        "actorUserId" integer,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_agent_config_override_audit_id" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_agent_config_override_audit_layer" CHECK ("layer" IN ('org', 'course'))
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_agent_config_override_audit_scope" ON "agent_config_override_audit" ("agentKey", "layer", "scopeId", "createdAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "agent_config_override_audit"`,
    );
  }
}
