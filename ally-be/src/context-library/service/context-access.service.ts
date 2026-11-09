import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  CONTEXT_USE_CASES,
  UseCaseSpec,
} from '../constants/context-use-cases.constants';
import { ClCollection } from '../entity/cl-collection.entity';
import {
  ClUseCaseAccess,
  ClUseCaseAccessLog,
} from '../entity/cl-use-case-access.entity';
import { ClAudienceRule, ClUseCase } from '../enum/context-library.enum';
import { getProfile } from '../profiles';

/** Who is asking, for organisation-scoped use cases. */
export interface ClAudience {
  /** The asker's organisation, or null for someone with none (they get global only). */
  tenantId: string | null;
}

export interface ResolvedGrant {
  collectionId: string;
  weight: number;
}

const GRANTS_TTL_MS = 60_000;

/**
 * Who may read what.
 *
 * Three layers, in order of authority:
 *  1. Locks on the collection profile (`neverGrantTo`) — code, never overridable.
 *  2. A grant row in `cl_use_case_access` for that use case and collection — data,
 *     editable in Settings.
 *  3. The use case's defaults, for any pair without a row. Per pair, so a collection added
 *     later still reaches the use cases that default to it.
 *
 * A request for a collection outside the resolved set is refused, never quietly filtered:
 * a caller that asked for something it may not read has a bug, and an error says so.
 */
@Injectable()
export class ContextAccessService {
  private cache: {
    at: number;
    rows: ClUseCaseAccess[];
    collections: ClCollection[];
  } | null = null;

  constructor(
    @InjectRepository(ClUseCaseAccess)
    private readonly grants: Repository<ClUseCaseAccess>,
    @InjectRepository(ClUseCaseAccessLog)
    private readonly grantLog: Repository<ClUseCaseAccessLog>,
    @InjectRepository(ClCollection)
    private readonly collections: Repository<ClCollection>,
  ) {}

  spec(useCase: ClUseCase): UseCaseSpec {
    const spec = CONTEXT_USE_CASES[useCase];
    if (!spec) throw new BadRequestException(`Unknown use case "${useCase}"`);
    return spec;
  }

  private async load() {
    if (this.cache && Date.now() - this.cache.at < GRANTS_TTL_MS)
      return this.cache;
    const [rows, collections] = await Promise.all([
      this.grants.find(),
      this.collections.find(),
    ]);
    this.cache = { at: Date.now(), rows, collections };
    return this.cache;
  }

  invalidate(): void {
    this.cache = null;
  }

  static isLocked(useCase: ClUseCase, collectionId: string): boolean {
    const profile = getProfile(collectionId);
    return !profile || profile.neverGrantTo.includes(useCase);
  }

  /** The collections this use case may read right now, with their fusion weights. */
  async grantedCollections(useCase: ClUseCase): Promise<ResolvedGrant[]> {
    const spec = this.spec(useCase);
    const { rows, collections } = await this.load();
    const live = new Set(
      collections.filter((c) => c.status === 'active').map((c) => c.id),
    );
    const own = new Map(
      rows.filter((r) => r.useCase === useCase).map((r) => [r.collectionId, r]),
    );
    const out: ResolvedGrant[] = [];
    for (const collectionId of live) {
      if (ContextAccessService.isLocked(useCase, collectionId)) continue;
      const row = own.get(collectionId);
      const enabled = row
        ? row.enabled
        : spec.defaultCollections.includes(collectionId as never);
      if (enabled) out.push({ collectionId, weight: row?.weight ?? 1 });
    }
    return out;
  }

  /**
   * Resolve a search's collections. `requested` must be a subset of the grants; anything
   * outside them is returned as `denied` and the caller refuses the request.
   */
  async resolve(
    useCase: ClUseCase,
    requested?: string[] | null,
  ): Promise<{ grants: ResolvedGrant[]; denied: string[] }> {
    const granted = await this.grantedCollections(useCase);
    if (!requested?.length) return { grants: granted, denied: [] };
    const byId = new Map(granted.map((g) => [g.collectionId, g]));
    const denied = requested.filter((id) => !byId.has(id));
    return {
      grants: requested.filter((id) => byId.has(id)).map((id) => byId.get(id)!),
      denied,
    };
  }

  /**
   * Organisation-scoped use cases must say who is asking. There is no safe default:
   * "everything" leaks other organisations' protocols, "global only" hides the asker's own.
   *
   * A platform use case has no audience filter — unless its caller names one, which can only
   * narrow what comes back. That is how the Library's search box searches as an organisation's
   * admin sees it: global entries plus that organisation's own, never another's.
   */
  assertAudience(
    useCase: ClUseCase,
    audience: ClAudience | null | undefined,
  ): ClAudience | null {
    const spec = this.spec(useCase);
    if (spec.audience === ClAudienceRule.ORGANISATION) {
      if (!audience || audience.tenantId === undefined) {
        throw new BadRequestException(
          `The ${spec.label} use case searches on someone's behalf and must say who is asking.`,
        );
      }
      return audience;
    }
    return audience && audience.tenantId !== undefined ? audience : null;
  }

  // ── Settings ──────────────────────────────────────────────────────────────

  async matrix() {
    const { rows, collections } = await this.load();
    return Object.values(CONTEXT_USE_CASES).map((spec) => {
      const own = rows.filter((r) => r.useCase === spec.id);
      return {
        useCase: spec.id,
        label: spec.label,
        audience: spec.audience,
        querySensitive: spec.querySensitive,
        collections: collections
          .filter((c) => getProfile(c.id))
          .map((c) => {
            const row = own.find((r) => r.collectionId === c.id);
            const locked = ContextAccessService.isLocked(spec.id, c.id);
            const enabled = row
              ? row.enabled
              : spec.defaultCollections.includes(c.id as never);
            return {
              collectionId: c.id,
              enabled: enabled && !locked,
              locked,
              weight: row?.weight ?? 1,
            };
          }),
      };
    });
  }

  async setGrant(
    useCase: ClUseCase,
    collectionId: string,
    enabled: boolean,
    weight: number | undefined,
    userId: number | null,
  ): Promise<void> {
    this.spec(useCase);
    if (enabled && ContextAccessService.isLocked(useCase, collectionId)) {
      throw new ForbiddenException(
        'That collection can never be read by this use case; the lock is in code, not a setting.',
      );
    }
    const row =
      (await this.grants.findOne({ where: { useCase, collectionId } })) ??
      this.grants.create({ useCase, collectionId, enabled: false, weight: 1 });
    const before = row.id ? row.enabled : null;
    row.enabled = enabled;
    if (weight !== undefined) row.weight = Math.max(0.1, Math.min(5, weight));
    row.updatedBy = userId;
    await this.grants.save(row);
    await this.grantLog.save(
      this.grantLog.create({
        useCase,
        collectionId,
        enabledBefore: before,
        enabledAfter: enabled,
        weightAfter: row.weight,
        changedBy: userId,
      }),
    );
    this.invalidate();
  }
}
