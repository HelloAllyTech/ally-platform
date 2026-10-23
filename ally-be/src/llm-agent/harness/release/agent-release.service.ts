import { createHash } from 'crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { AgentRelease } from 'src/llm-agent/entity/agent-release.entity';
import { AgentReleaseAudit } from 'src/llm-agent/entity/agent-release-audit.entity';
import {
  AgentReleaseAuditAction,
  AgentReleaseAuthorKind,
  AgentReleaseStatus,
} from '../enum/harness.enum';
import { canonicalHash } from './canonical-hash.util';

/** How long a GA lookup is reused; a promotion or rollback clears it at once. */
export const RELEASE_CACHE_MS = 30_000;
/** Plan Appendix A: a canary never takes more than 30% of new epochs. */
export const CANARY_MAX_PERCENT = 30;

/**
 * Whether a thread's new epoch lands in the canary: a stable hash of the
 * thread and the canary release, so a thread stays in its arm for that
 * canary and a new canary reshuffles who sees it.
 */
export function inCanary(
  threadId: string,
  canaryReleaseId: string,
  percent: number,
): boolean {
  const bucket =
    parseInt(
      createHash('sha256')
        .update(`${threadId}:${canaryReleaseId}`)
        .digest('hex')
        .slice(0, 8),
      16,
    ) % 100;
  return bucket < percent;
}

const PG_UNIQUE_VIOLATION = '23505';

/**
 * Releases (plans/ally-guide/plan.md §7.4): immutable, versioned behaviour
 * bundles with exactly one GA per agent. v1 of the pipeline is manual —
 * draft → (canary at a share of new epochs) → promote → GA, with one-step
 * rollback. Evaluation and shadow stages arrive with milestone M4 and slot in
 * before the canary.
 */
@Injectable()
export class AgentReleaseService {
  private readonly logger = LoggerService.getInstance(AgentReleaseService.name);
  private readonly gaCache = new Map<
    string,
    { release: AgentRelease | null; readAt: number }
  >();

  private readonly canaryCache = new Map<
    string,
    { release: AgentRelease | null; readAt: number }
  >();

  private readonly emergencyCache = new Map<
    string,
    { id: string | null; readAt: number }
  >();

  constructor(private readonly dataSource: DataSource) {}

  private get releases() {
    return this.dataSource.getRepository(AgentRelease);
  }

  private get audit() {
    return this.dataSource.getRepository(AgentReleaseAudit);
  }

  /** The release every new epoch uses, or null if the agent has none. */
  async getGa(agentKey: string): Promise<AgentRelease | null> {
    const cached = this.gaCache.get(agentKey);
    if (cached && Date.now() - cached.readAt < RELEASE_CACHE_MS) {
      return cached.release;
    }
    const release = await this.releases.findOne({
      where: { agentKey, status: AgentReleaseStatus.GA },
    });
    this.gaCache.set(agentKey, { release, readAt: Date.now() });
    return release;
  }

  /**
   * The agent's latest emergency (safety) rollback, by audit-row id, or null.
   * A thread whose epoch began before it moves to the GA at its next turn
   * instead of its next epoch (plan §7.4). Compared by id, not time, so the
   * check never mixes database time with a process clock. Shares the GA
   * cache's lifetime.
   */
  async lastEmergencyRollbackId(agentKey: string): Promise<string | null> {
    const cached = this.emergencyCache.get(agentKey);
    if (cached && Date.now() - cached.readAt < RELEASE_CACHE_MS) {
      return cached.id;
    }
    const row = await this.audit.findOne({
      where: { agentKey, action: AgentReleaseAuditAction.EMERGENCY_ROLLBACK },
      order: { createdAt: 'DESC' },
    });
    const id = row?.id ?? null;
    this.emergencyCache.set(agentKey, { id, readAt: Date.now() });
    return id;
  }

  async getById(id: string): Promise<AgentRelease> {
    const release = await this.releases.findOne({ where: { id } });
    if (!release) throw new NotFoundException('Release not found');
    return release;
  }

  list(agentKey: string): Promise<AgentRelease[]> {
    return this.releases.find({
      where: { agentKey },
      order: { version: 'DESC' },
    });
  }

  /**
   * Make sure an agent has a GA release, creating version 1 from the bundle in
   * code if it has none. Idempotent and race-safe: two instances booting at
   * once collide on the unique (agentKey, version), and the loser re-reads.
   */
  async ensureSeed(
    agentKey: string,
    bundle: Record<string, unknown>,
  ): Promise<AgentRelease | null> {
    const existingGa = await this.releases.findOne({
      where: { agentKey, status: AgentReleaseStatus.GA },
    });
    if (existingGa) return existingGa;
    const anyRelease = await this.releases.count({ where: { agentKey } });
    if (anyRelease > 0) {
      // Releases exist but none is GA — an operator retired it. Never
      // resurrect behaviour silently; the agent stays without a GA.
      this.logger.warn(
        `${agentKey} has releases but no GA one; not seeding over them`,
      );
      return null;
    }
    try {
      return await this.dataSource.transaction(async (manager) => {
        const release = await manager.getRepository(AgentRelease).save(
          manager.getRepository(AgentRelease).create({
            agentKey,
            version: 1,
            status: AgentReleaseStatus.GA,
            bundle,
            contentHash: canonicalHash(bundle),
            authorKind: AgentReleaseAuthorKind.SEED,
            notes: 'Seeded from the bundle in code on first boot.',
            promotedAt: new Date(),
          }),
        );
        await manager.getRepository(AgentReleaseAudit).save({
          agentKey,
          releaseId: release.id,
          action: AgentReleaseAuditAction.CREATED,
          actorKind: AgentReleaseAuthorKind.SEED,
          detail: { version: 1, status: AgentReleaseStatus.GA },
        });
        this.gaCache.delete(agentKey);
        return release;
      });
    } catch (error) {
      if ((error as { code?: string })?.code === PG_UNIQUE_VIOLATION) {
        const winner = await this.releases.findOne({
          where: { agentKey, status: AgentReleaseStatus.GA },
        });
        if (winner) return winner;
      }
      throw error;
    }
  }

  /**
   * Bring an agent's releases in line with the bundle in code, at boot.
   *
   * - No releases yet: version 1, GA (what `ensureSeed` does).
   * - GA already holds this bundle: nothing to do.
   * - The code's bundle changed and only seeds have ever touched releases:
   *   the new bundle becomes the next version and goes GA. This is the
   *   pre-launch path — every deploy that changes a prompt or a policy value
   *   ships it, with an audit row saying so.
   * - The code's bundle changed after a person (or the curator) authored,
   *   promoted or rolled back a release: it is created as a DRAFT and the GA
   *   stays. A deploy must never undo a deliberate rollback.
   *
   * Serialised across instances with a transaction-scoped advisory lock.
   */
  async syncSeed(
    agentKey: string,
    bundle: Record<string, unknown>,
  ): Promise<AgentRelease | null> {
    const hash = canonicalHash(bundle);
    const result = await this.dataSource.transaction(async (manager) => {
      await manager.query?.('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `agent-release-seed:${agentKey}`,
      ]);
      const repo = manager.getRepository(AgentRelease);
      const auditRepo = manager.getRepository(AgentReleaseAudit);
      const all = await repo.find({
        where: { agentKey },
        order: { version: 'DESC' },
      });
      const ga = all.find((r) => r.status === AgentReleaseStatus.GA) ?? null;
      if (ga?.contentHash === hash) return { release: ga, changed: false };

      const nextVersion = (all[0]?.version ?? 0) + 1;
      const createSeed = async (status: AgentReleaseStatus, notes: string) => {
        const release = await repo.save(
          repo.create({
            agentKey,
            version: nextVersion,
            status,
            bundle,
            contentHash: hash,
            parentReleaseId: ga?.id ?? null,
            authorKind: AgentReleaseAuthorKind.SEED,
            notes,
            promotedAt: status === AgentReleaseStatus.GA ? new Date() : null,
          }),
        );
        await auditRepo.save({
          agentKey,
          releaseId: release.id,
          action: AgentReleaseAuditAction.CREATED,
          actorKind: AgentReleaseAuthorKind.SEED,
          detail: { version: release.version, status, contentHash: hash },
        });
        return release;
      };

      if (all.length === 0) {
        const release = await createSeed(
          AgentReleaseStatus.GA,
          'Seeded from the bundle in code on first boot.',
        );
        return { release, changed: true };
      }

      const audit = await auditRepo.find({ where: { agentKey } });
      const peopleInvolved =
        all.some((r) => r.authorKind !== AgentReleaseAuthorKind.SEED) ||
        audit.some((a) => a.actorKind !== AgentReleaseAuthorKind.SEED);
      const existing = all.find((r) => r.contentHash === hash) ?? null;

      if (peopleInvolved || !ga) {
        if (!existing) {
          await createSeed(
            AgentReleaseStatus.DRAFT,
            'The defaults in code changed. Review this draft and promote it ' +
              'to ship them; the current GA is unchanged.',
          );
          this.logger.warn(
            `${agentKey}: code defaults changed; created a draft, GA unchanged`,
          );
        }
        return { release: ga, changed: false };
      }

      // Only seeds so far: ship the code's bundle.
      const target =
        existing ??
        (await createSeed(
          AgentReleaseStatus.DRAFT,
          'The defaults in code changed; promoted at boot while no release ' +
            'had been authored or promoted by a person.',
        ));
      await repo.update(ga.id, {
        status: AgentReleaseStatus.RETIRED,
        retiredAt: new Date(),
      });
      await repo.update(target.id, {
        status: AgentReleaseStatus.GA,
        promotedAt: new Date(),
        retiredAt: null,
        rolloutPercent: null,
      });
      await auditRepo.save({
        agentKey,
        releaseId: target.id,
        action: AgentReleaseAuditAction.PROMOTED,
        actorKind: AgentReleaseAuthorKind.SEED,
        detail: {
          fromReleaseId: ga.id,
          fromVersion: ga.version,
          toVersion: target.version,
          reason: 'code defaults changed',
        },
      });
      return {
        release: { ...target, status: AgentReleaseStatus.GA } as AgentRelease,
        changed: true,
      };
    });
    this.gaCache.delete(agentKey);
    if (result.changed && result.release) {
      this.logger.info(
        `${agentKey} release v${result.release.version} is GA (seeded from code)`,
      );
    }
    return result.release;
  }

  /** A new DRAFT version. Its bundle is fixed from here on. */
  async createDraft(
    agentKey: string,
    bundle: Record<string, unknown>,
    userId: number,
    notes?: string,
  ): Promise<AgentRelease> {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(AgentRelease);
      const latest = await repo.findOne({
        where: { agentKey },
        order: { version: 'DESC' },
      });
      const release = await repo.save(
        repo.create({
          agentKey,
          version: (latest?.version ?? 0) + 1,
          status: AgentReleaseStatus.DRAFT,
          bundle,
          contentHash: canonicalHash(bundle),
          parentReleaseId: latest?.id ?? null,
          authorKind: AgentReleaseAuthorKind.HUMAN,
          createdBy: userId,
          notes: notes ?? null,
        }),
      );
      await manager.getRepository(AgentReleaseAudit).save({
        agentKey,
        releaseId: release.id,
        action: AgentReleaseAuditAction.CREATED,
        actorKind: AgentReleaseAuthorKind.HUMAN,
        actorUserId: userId,
        detail: { version: release.version, contentHash: release.contentHash },
      });
      return release;
    });
  }

  /**
   * Make `releaseId` the GA release. The previous GA is retired (it stays
   * available as a rollback target). Used for both promotion and rollback;
   * `action` records which it was.
   */
  async makeGa(
    releaseId: string,
    userId: number,
    action:
      | AgentReleaseAuditAction.PROMOTED
      | AgentReleaseAuditAction.ROLLED_BACK
      | AgentReleaseAuditAction.EMERGENCY_ROLLBACK = AgentReleaseAuditAction.PROMOTED,
    reason?: string,
  ): Promise<AgentRelease> {
    const promoted = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(AgentRelease);
      const target = await repo.findOne({ where: { id: releaseId } });
      if (!target) throw new NotFoundException('Release not found');
      if (target.status === AgentReleaseStatus.GA) return target;
      const current = await repo.findOne({
        where: { agentKey: target.agentKey, status: AgentReleaseStatus.GA },
      });
      if (current) {
        await repo.update(current.id, {
          status: AgentReleaseStatus.RETIRED,
          retiredAt: new Date(),
        });
      }
      await repo.update(target.id, {
        status: AgentReleaseStatus.GA,
        promotedAt: new Date(),
        retiredAt: null,
      });
      await manager.getRepository(AgentReleaseAudit).save({
        agentKey: target.agentKey,
        releaseId: target.id,
        action,
        actorKind: AgentReleaseAuthorKind.HUMAN,
        actorUserId: userId,
        detail: {
          fromReleaseId: current?.id ?? null,
          fromVersion: current?.version ?? null,
          toVersion: target.version,
          reason: reason ?? null,
        },
      });
      return { ...target, status: AgentReleaseStatus.GA } as AgentRelease;
    });
    this.gaCache.delete(promoted.agentKey);
    this.canaryCache.delete(promoted.agentKey);
    this.emergencyCache.delete(promoted.agentKey);
    this.logger.info(
      `${promoted.agentKey} release v${promoted.version} is now GA (${action}) by user ${userId}`,
    );
    return promoted;
  }

  /** The release in canary, if any (plan §7.4: at most one per agent). */
  async getCanary(agentKey: string): Promise<AgentRelease | null> {
    const cached = this.canaryCache.get(agentKey);
    if (cached && Date.now() - cached.readAt < RELEASE_CACHE_MS) {
      return cached.release;
    }
    const release = await this.releases.findOne({
      where: { agentKey, status: AgentReleaseStatus.CANARY },
    });
    this.canaryCache.set(agentKey, { release, readAt: Date.now() });
    return release;
  }

  /**
   * Put a draft or candidate in front of `percent` of new epochs (plan §7.4,
   * Appendix A: 20% by default, never more than 30%). One canary at a time;
   * promote it with makeGa, or stop it.
   */
  async startCanary(
    releaseId: string,
    percent: number,
    userId: number,
    reason?: string,
  ): Promise<AgentRelease> {
    const share = Math.floor(percent);
    if (!Number.isFinite(share) || share < 1 || share > CANARY_MAX_PERCENT) {
      throw new BadRequestException(
        `A canary takes 1–${CANARY_MAX_PERCENT}% of new conversations.`,
      );
    }
    const started = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(AgentRelease);
      const target = await repo.findOne({ where: { id: releaseId } });
      if (!target) throw new NotFoundException('Release not found');
      if (
        ![
          AgentReleaseStatus.DRAFT,
          AgentReleaseStatus.CANDIDATE,
          AgentReleaseStatus.SHADOW,
          AgentReleaseStatus.CANARY,
        ].includes(target.status)
      ) {
        throw new BadRequestException(
          `A ${target.status} release cannot go to canary.`,
        );
      }
      const other = await repo.findOne({
        where: { agentKey: target.agentKey, status: AgentReleaseStatus.CANARY },
      });
      if (other && other.id !== target.id) {
        throw new BadRequestException(
          `v${other.version} is already in canary. Promote or stop it first.`,
        );
      }
      await repo.update(target.id, {
        status: AgentReleaseStatus.CANARY,
        rolloutPercent: share,
      });
      await manager.getRepository(AgentReleaseAudit).save({
        agentKey: target.agentKey,
        releaseId: target.id,
        action: AgentReleaseAuditAction.CANARY_STARTED,
        actorKind: AgentReleaseAuthorKind.HUMAN,
        actorUserId: userId,
        detail: {
          version: target.version,
          percent: share,
          fromStatus: target.status,
          reason: reason ?? null,
        },
      });
      return {
        ...target,
        status: AgentReleaseStatus.CANARY,
        rolloutPercent: share,
      } as AgentRelease;
    });
    this.canaryCache.delete(started.agentKey);
    this.logger.info(
      `${started.agentKey} release v${started.version} in canary at ${share}% by user ${userId}`,
    );
    return started;
  }

  /**
   * End the canary without promoting it: the release is retired and new
   * epochs all get GA. With `emergency` (a safety reason) every thread moves
   * to GA at its next turn, as an emergency rollback does; otherwise canary
   * threads finish their epoch first.
   */
  async stopCanary(
    agentKey: string,
    userId: number,
    emergency: boolean,
    reason?: string,
  ): Promise<AgentRelease> {
    const stopped = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(AgentRelease);
      const canary = await repo.findOne({
        where: { agentKey, status: AgentReleaseStatus.CANARY },
      });
      if (!canary) throw new BadRequestException('No release is in canary.');
      await repo.update(canary.id, {
        status: AgentReleaseStatus.RETIRED,
        retiredAt: new Date(),
      });
      const audit = manager.getRepository(AgentReleaseAudit);
      await audit.save({
        agentKey,
        releaseId: canary.id,
        action: AgentReleaseAuditAction.CANARY_STOPPED,
        actorKind: AgentReleaseAuthorKind.HUMAN,
        actorUserId: userId,
        detail: {
          version: canary.version,
          emergency,
          reason: reason ?? null,
        },
      });
      if (emergency) {
        // The same marker an emergency rollback leaves: every thread's next
        // turn starts a new epoch on GA.
        await audit.save({
          agentKey,
          releaseId: canary.id,
          action: AgentReleaseAuditAction.EMERGENCY_ROLLBACK,
          actorKind: AgentReleaseAuthorKind.HUMAN,
          actorUserId: userId,
          detail: { canaryStopped: true, reason: reason ?? null },
        });
      }
      return {
        ...canary,
        status: AgentReleaseStatus.RETIRED,
      } as AgentRelease;
    });
    this.canaryCache.delete(agentKey);
    this.emergencyCache.delete(agentKey);
    this.logger.info(
      `${agentKey} canary v${stopped.version} stopped${emergency ? ' (emergency)' : ''} by user ${userId}`,
    );
    return stopped;
  }

  /** Roll back to the GA release before the current one. */
  async rollback(
    agentKey: string,
    userId: number,
    emergency: boolean,
    reason?: string,
  ): Promise<AgentRelease> {
    const audit = await this.audit.find({
      where: { agentKey },
      order: { createdAt: 'DESC' },
      take: 50,
    });
    const lastChange = audit.find((row) =>
      [
        AgentReleaseAuditAction.PROMOTED,
        AgentReleaseAuditAction.ROLLED_BACK,
        AgentReleaseAuditAction.EMERGENCY_ROLLBACK,
      ].includes(row.action),
    );
    const previousId = lastChange?.detail?.fromReleaseId as string | undefined;
    if (!previousId) {
      throw new BadRequestException(
        'There is no earlier GA release to roll back to.',
      );
    }
    return this.makeGa(
      previousId,
      userId,
      emergency
        ? AgentReleaseAuditAction.EMERGENCY_ROLLBACK
        : AgentReleaseAuditAction.ROLLED_BACK,
      reason,
    );
  }
}
