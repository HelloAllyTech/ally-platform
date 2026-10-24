import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AgentConfigOverrideAudit } from 'src/llm-agent/entity/agent-config-override-audit.entity';
import { AgentConfigOverride } from 'src/llm-agent/entity/agent-config-override.entity';
import {
  AgentConfigOverrideService,
  OverrideChange,
} from 'src/llm-agent/harness/config/agent-config-override.service';
import {
  PolicyKeySpec,
  PolicyOverrideLayer,
  PolicyValue,
  flattenPolicy,
} from 'src/llm-agent/harness/config/policy-schema';
import { AgentReleaseService } from 'src/llm-agent/harness/release/agent-release.service';
import { AgentConfigLayer } from 'src/llm-agent/harness/enum/harness.enum';
import { userNames } from '../admin/user-names';
import {
  ALLY_GUIDE_AGENT_KEY,
  GUIDE_DEFAULT_POLICY,
  GuideReleaseBundle,
} from '../release/guide-release.bundle';
import { GUIDE_POLICY_SCHEMA } from '../release/policy.schema';

/** One schema key as the Configuration tab's generated forms need it. */
export interface GuideConfigField extends Omit<PolicyKeySpec, 'default'> {
  key: string;
  /** The live GA release's value (what applies when nothing overrides it). */
  releaseValue: PolicyValue;
}

export interface GuideConfigLayerView {
  layer: PolicyOverrideLayer;
  scopeId: string;
  scopeName: string | null;
  /** 0 when nothing has been saved; send it back as `expectedVersion`. */
  version: number;
  updatedAt: string | null;
  updatedBy: string | null;
  /** Only the keys this layer may set. */
  fields: Array<GuideConfigField & { override: { value: PolicyValue } | null }>;
  audit: GuideConfigAuditRow[];
}

export interface GuideConfigAuditRow {
  key: string;
  oldValue: { value: unknown } | null;
  newValue: { value: unknown } | null;
  version: number;
  actor: string | null;
  actorUserId: number | null;
  createdAt: string;
}

const AUDIT_ROWS_IN_VIEW = 20;

/**
 * The Configuration tab's API behind `v1/guide/admin/config/*` (plan §7.5,
 * §10.5): the schema for generated forms, one layer's overrides for an
 * organisation or a course, saving them (audited, effective from each
 * thread's next epoch), and the platform listing of every override.
 */
@Injectable()
export class GuideConfigAdminService {
  constructor(
    private readonly overrides: AgentConfigOverrideService,
    private readonly releases: AgentReleaseService,
    private readonly dataSource: DataSource,
  ) {}

  /** Every key, grouped as declared, with the live release's values. */
  async schema(): Promise<{ fields: GuideConfigField[] }> {
    const releaseValues = await this.releaseValues();
    return {
      fields: Object.entries(GUIDE_POLICY_SCHEMA).map(([key, spec]) =>
        field(key, spec, releaseValues),
      ),
    };
  }

  async layerView(
    layer: AgentConfigLayer,
    scopeId: string,
  ): Promise<GuideConfigLayerView> {
    const scopeName = await this.scopeName(layer, scopeId);
    const [row, releaseValues, audit] = await Promise.all([
      this.overrides.get(ALLY_GUIDE_AGENT_KEY, layer, scopeId),
      this.releaseValues(),
      this.overrides.audit(ALLY_GUIDE_AGENT_KEY, {
        layer,
        scopeId,
        limit: AUDIT_ROWS_IN_VIEW,
      }),
    ]);
    const names = await userNames(this.dataSource, [
      row?.updatedBy,
      ...audit.map((entry) => entry.actorUserId),
    ]);
    const values = (row?.values ?? {}) as Record<string, PolicyValue>;
    return {
      layer: layer as PolicyOverrideLayer,
      scopeId,
      scopeName,
      version: row?.version ?? 0,
      updatedAt: row?.updatedAt ? new Date(row.updatedAt).toISOString() : null,
      updatedBy: row?.updatedBy ? (names.get(row.updatedBy) ?? null) : null,
      fields: Object.entries(GUIDE_POLICY_SCHEMA)
        .filter(([, spec]) =>
          spec.overridableBy.includes(layer as PolicyOverrideLayer),
        )
        .map(([key, spec]) => ({
          ...field(key, spec, releaseValues),
          override: key in values ? { value: values[key] } : null,
        })),
      audit: audit.map((entry) => auditRow(entry, names)),
    };
  }

  async save(input: {
    layer: AgentConfigLayer;
    scopeId: string;
    change: OverrideChange;
    expectedVersion?: number | null;
    userId: number;
  }): Promise<GuideConfigLayerView> {
    await this.scopeName(input.layer, input.scopeId);
    await this.overrides.save({
      agentKey: ALLY_GUIDE_AGENT_KEY,
      layer: input.layer,
      scopeId: input.scopeId,
      schema: GUIDE_POLICY_SCHEMA,
      change: input.change,
      actorUserId: input.userId,
      expectedVersion: input.expectedVersion,
    });
    return this.layerView(input.layer, input.scopeId);
  }

  /** Every organisation and course that overrides anything, newest first. */
  async listOverrides(layer?: AgentConfigLayer) {
    const rows = await this.overrides.list(ALLY_GUIDE_AGENT_KEY, layer);
    const [tenants, tracks, names] = await Promise.all([
      this.namesFor(
        'tenants',
        'name',
        rows.filter((row) => row.layer === AgentConfigLayer.ORG),
      ),
      this.namesFor(
        'tracks',
        'title',
        rows.filter((row) => row.layer === AgentConfigLayer.COURSE),
      ),
      userNames(
        this.dataSource,
        rows.map((row) => row.updatedBy),
      ),
    ]);
    return rows
      .filter((row) => Object.keys(row.values ?? {}).length > 0)
      .map((row) => ({
        layer: row.layer,
        scopeId: row.scopeId,
        scopeName:
          (row.layer === AgentConfigLayer.ORG ? tenants : tracks).get(
            row.scopeId,
          ) ?? null,
        values: row.values,
        version: row.version,
        updatedAt: new Date(row.updatedAt).toISOString(),
        updatedBy: row.updatedBy ? (names.get(row.updatedBy) ?? null) : null,
      }));
  }

  async auditLog(filter: {
    layer?: AgentConfigLayer;
    scopeId?: string;
    limit?: number;
  }): Promise<GuideConfigAuditRow[]> {
    const rows = await this.overrides.audit(ALLY_GUIDE_AGENT_KEY, filter);
    const names = await userNames(
      this.dataSource,
      rows.map((row) => row.actorUserId),
    );
    return rows.map((row) => auditRow(row, names));
  }

  private async releaseValues(): Promise<Record<string, unknown>> {
    const ga = await this.releases.getGa(ALLY_GUIDE_AGENT_KEY);
    return flattenPolicy(
      (ga?.bundle as unknown as GuideReleaseBundle | undefined)?.policy ??
        GUIDE_DEFAULT_POLICY,
    );
  }

  /** The organisation's or course's name; 404 when it does not exist. */
  private async scopeName(
    layer: AgentConfigLayer,
    scopeId: string,
  ): Promise<string | null> {
    const [table, column, what] =
      layer === AgentConfigLayer.ORG
        ? ['tenants', 'name', 'Organisation']
        : ['tracks', 'title', 'Course'];
    const rows: Array<{ name: string | null }> = await this.dataSource.query(
      `SELECT "${column}" AS "name" FROM "${table}" WHERE "id"::text = $1`,
      [scopeId],
    );
    if (!rows.length) throw new NotFoundException(`${what} not found`);
    return rows[0].name ?? null;
  }

  private async namesFor(
    table: 'tenants' | 'tracks',
    column: 'name' | 'title',
    rows: AgentConfigOverride[],
  ): Promise<Map<string, string>> {
    const ids = [...new Set(rows.map((row) => row.scopeId))];
    if (!ids.length) return new Map();
    const found: Array<{ id: string; name: string | null }> =
      await this.dataSource.query(
        `SELECT "id"::text AS "id", "${column}" AS "name" FROM "${table}" WHERE "id"::text = ANY($1::text[])`,
        [ids],
      );
    return new Map(
      found
        .filter((row) => row.name)
        .map((row) => [row.id, row.name!] as const),
    );
  }
}

function field(
  key: string,
  spec: PolicyKeySpec,
  releaseValues: Record<string, unknown>,
): GuideConfigField {
  const { default: fallback, ...rest } = spec;
  return {
    key,
    ...rest,
    releaseValue: (key in releaseValues
      ? releaseValues[key]
      : fallback) as PolicyValue,
  };
}

function auditRow(
  row: AgentConfigOverrideAudit,
  names: Map<number, string>,
): GuideConfigAuditRow {
  return {
    key: row.key,
    oldValue: row.oldValue ?? null,
    newValue: row.newValue ?? null,
    version: row.version,
    actorUserId: row.actorUserId ?? null,
    actor: row.actorUserId ? (names.get(row.actorUserId) ?? null) : null,
    createdAt: new Date(row.createdAt).toISOString(),
  };
}
