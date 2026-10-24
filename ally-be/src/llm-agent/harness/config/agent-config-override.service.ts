import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { isDeepStrictEqual } from 'util';
import { DataSource, Repository } from 'typeorm';
import { AgentConfigOverrideAudit } from '../../entity/agent-config-override-audit.entity';
import { AgentConfigOverride } from '../../entity/agent-config-override.entity';
import { AgentConfigLayer } from '../enum/harness.enum';
import {
  PolicySchema,
  PolicyValue,
  PolicyValues,
  overrideRefusal,
} from './policy-schema';

export interface OverrideChange {
  /** key → new value. `null` is a value here (for example "off"). */
  set?: Record<string, unknown>;
  /** Keys to remove, so the layer below decides again. */
  clear?: string[];
}

export interface OverrideRefusalDetail {
  key: string;
  code: 'unknown' | 'pinned' | 'layer' | 'value';
  message: string;
}

/**
 * Org- and course-layer overrides for any harness agent (plan §7.5), with an
 * audit row for every key that changes. Validation is the agent's schema:
 * a key the layer may not set — pinned, platform-only, unknown, or an
 * illegal value — refuses the whole write with one reason per key, and
 * nothing is stored.
 *
 * The resolver reads these rows only when an epoch begins, so a change takes
 * effect from each thread's next epoch, never mid-conversation.
 */
@Injectable()
export class AgentConfigOverrideService {
  constructor(
    @InjectRepository(AgentConfigOverride)
    private readonly overrides: Repository<AgentConfigOverride>,
    @InjectRepository(AgentConfigOverrideAudit)
    private readonly audits: Repository<AgentConfigOverrideAudit>,
    private readonly dataSource: DataSource,
  ) {}

  async get(
    agentKey: string,
    layer: AgentConfigLayer,
    scopeId: string,
  ): Promise<AgentConfigOverride | null> {
    return this.overrides.findOne({ where: { agentKey, layer, scopeId } });
  }

  /** Both layers' rows for one thread's scope, in one query. */
  async forScopes(
    agentKey: string,
    scopes: { tenantId?: string | null; trackId?: string | null },
  ): Promise<{
    org: AgentConfigOverride | null;
    course: AgentConfigOverride | null;
  }> {
    const where: {
      agentKey: string;
      layer: AgentConfigLayer;
      scopeId: string;
    }[] = [];
    if (scopes.tenantId) {
      where.push({
        agentKey,
        layer: AgentConfigLayer.ORG,
        scopeId: scopes.tenantId,
      });
    }
    if (scopes.trackId) {
      where.push({
        agentKey,
        layer: AgentConfigLayer.COURSE,
        scopeId: scopes.trackId,
      });
    }
    if (!where.length) return { org: null, course: null };
    const rows = await this.overrides.find({ where });
    return {
      org: rows.find((row) => row.layer === AgentConfigLayer.ORG) ?? null,
      course: rows.find((row) => row.layer === AgentConfigLayer.COURSE) ?? null,
    };
  }

  /** Every override row for the agent (the platform listing). */
  list(
    agentKey: string,
    layer?: AgentConfigLayer,
  ): Promise<AgentConfigOverride[]> {
    return this.overrides.find({
      where: { agentKey, ...(layer ? { layer } : {}) },
      order: { updatedAt: 'DESC' },
    });
  }

  audit(
    agentKey: string,
    filter: { layer?: AgentConfigLayer; scopeId?: string; limit?: number },
  ): Promise<AgentConfigOverrideAudit[]> {
    return this.audits.find({
      where: {
        agentKey,
        ...(filter.layer ? { layer: filter.layer } : {}),
        ...(filter.scopeId ? { scopeId: filter.scopeId } : {}),
      },
      order: { createdAt: 'DESC' },
      take: Math.min(Math.max(filter.limit ?? 50, 1), 200),
    });
  }

  /**
   * Apply a change to one scope's overrides.
   *
   * @throws BadRequestException `{ message: string[], errors:
   *   OverrideRefusalDetail[] }` when any key is refused — nothing is written.
   * @throws ConflictException when `expectedVersion` is given and someone
   *   saved in between.
   */
  async save(input: {
    agentKey: string;
    layer: AgentConfigLayer;
    scopeId: string;
    schema: PolicySchema;
    change: OverrideChange;
    actorUserId: number | null;
    expectedVersion?: number | null;
  }): Promise<AgentConfigOverride> {
    const errors = refusalsFor(input.schema, input.layer, input.change);
    if (errors.length) {
      // `message` is the array the exception filter passes to the client:
      // one sentence per refused key, each starting with the key. `errors`
      // is for in-process callers (the filter drops it).
      throw new BadRequestException({
        message: errors.map((error) => error.message),
        error: 'Bad Request',
        errors,
      });
    }

    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(AgentConfigOverride);
      const existing = await repo.findOne({
        where: {
          agentKey: input.agentKey,
          layer: input.layer,
          scopeId: input.scopeId,
        },
        lock: { mode: 'pessimistic_write' },
      });
      const currentVersion = existing?.version ?? 0;
      if (
        input.expectedVersion != null &&
        input.expectedVersion !== currentVersion
      ) {
        throw new ConflictException(
          'Someone else changed these settings since you opened them. Reload to see their change, then save again.',
        );
      }

      const before: PolicyValues = {
        ...((existing?.values ?? {}) as PolicyValues),
      };
      const after: PolicyValues = { ...before };
      for (const key of input.change.clear ?? []) delete after[key];
      for (const [key, value] of Object.entries(input.change.set ?? {})) {
        after[key] = value as PolicyValue;
      }

      const changed = [
        ...new Set([...Object.keys(before), ...Object.keys(after)]),
      ]
        .filter(
          (key) =>
            key in before !== key in after ||
            !isDeepStrictEqual(before[key], after[key]),
        )
        .sort();
      if (existing && changed.length === 0) return existing;

      const version = currentVersion + 1;
      const saved = await repo.save({
        ...(existing ?? {}),
        agentKey: input.agentKey,
        layer: input.layer,
        scopeId: input.scopeId,
        values: after,
        version,
        updatedBy: input.actorUserId,
      });
      if (changed.length) {
        const audit = manager.getRepository(AgentConfigOverrideAudit);
        await audit.save(
          changed.map((key) =>
            audit.create({
              agentKey: input.agentKey,
              layer: input.layer,
              scopeId: input.scopeId,
              key,
              oldValue: key in before ? { value: before[key] } : null,
              newValue: key in after ? { value: after[key] } : null,
              version,
              actorUserId: input.actorUserId,
            }),
          ),
        );
      }
      return saved;
    });
  }
}

/** Every reason a change can't be stored, one per key. */
export function refusalsFor(
  schema: PolicySchema,
  layer: AgentConfigLayer,
  change: OverrideChange,
): OverrideRefusalDetail[] {
  const errors: OverrideRefusalDetail[] = [];
  for (const [key, value] of Object.entries(change.set ?? {})) {
    const refusal = overrideRefusal(schema, layer, key, value);
    if (refusal) errors.push({ key, ...refusal });
  }
  for (const key of change.clear ?? []) {
    // Clearing is always safe for a known key: it can only hand the decision
    // back to the layer below. An unknown key is a typo worth reporting.
    if (!schema[key]) {
      errors.push({ key, code: 'unknown', message: `${key} is not a setting` });
    }
  }
  return errors;
}
