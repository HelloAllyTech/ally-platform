import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash, randomUUID } from 'crypto';
import {
  PlanCheck,
  PlanCheckFinding,
} from 'src/product-planning/entity/plan-check.entity';
import {
  PlanEventKind,
  PlanNotificationKind,
  PlanStage,
} from 'src/product-planning/enum/product-planning.enum';
import { PlanEventService } from 'src/product-planning/service/plan-event.service';
import { PlanNotificationService } from 'src/product-planning/service/plan-notification.service';
import {
  mergeImpactTags,
  tagsForPaths,
} from 'src/product-planning/util/plan-impact.util';
import {
  PlanCheckKind,
  requiredChecks,
} from 'src/product-planning/util/plan-readiness.util';
import { PlanAiService, PLANNING_PROMPTS } from './plan-ai.service';
import { PlanSession } from './plan-session.store';

/** A reviewer is advisory (shadow) for its first plans, then blocks (rev 5.2 §A.5). */
export const SHADOW_PLANS = 10;
/** A high-severity finding needs a real reason to resolve (rev 5.2 decision 3). */
export const HIGH_REASON_MIN = 20;

const PROMPT: Record<PlanCheckKind, string> = {
  safety: PLANNING_PROMPTS.SAFETY_REVIEW,
  privacy: PLANNING_PROMPTS.PRIVACY_REVIEW,
  ai_quality: PLANNING_PROMPTS.AI_QUALITY_REVIEW,
};

/** The PRD and design a check judges, for staleness. */
export function checkFactsHash(prd: unknown): string {
  const doc = (prd ?? {}) as Record<string, unknown>;
  return createHash('sha256')
    .update(JSON.stringify(doc))
    .digest('hex')
    .slice(0, 64);
}

/** Repo paths a PRD or design names, for code-derived impact tags. */
export function pathsIn(prd: unknown): string[] {
  const text = JSON.stringify(prd ?? {});
  const found = text.match(
    /\b(?:ally-(?:be|web|ai|ai-learn|mobile|mobile-flutter)\/)[A-Za-z0-9_./-]+/g,
  );
  return [...new Set(found ?? [])].slice(0, 500);
}

/**
 * The review board (rev 5.2 §B.8.4, P4). Code decides which checks a plan
 * needs; a cold reviewer (it never sees the conversation) finds risks; the lead
 * resolves each finding, fixed or dismissed, always with a reason.
 */
@Injectable()
export class PlanCheckService {
  constructor(
    @InjectRepository(PlanCheck)
    private readonly checks: Repository<PlanCheck>,
    private readonly ai: PlanAiService,
    private readonly events: PlanEventService,
    private readonly notifications: PlanNotificationService,
  ) {}

  list(sessionId: string): Promise<PlanCheck[]> {
    return this.checks.find({ where: { sessionId }, order: { kind: 'ASC' } });
  }

  /**
   * Add code's impact tags for the paths the PRD names, then run every
   * required check that has not judged this exact PRD yet. Returns the tags
   * to persist.
   */
  async run(
    plan: PlanSession,
    prd: unknown,
    actorUserId: number,
    only?: PlanCheckKind,
  ) {
    const tags = mergeImpactTags(
      plan.plan.impactTags ?? [],
      (plan.plan.impactTags ?? [])
        .filter((t) => t.source === 'lead')
        .map((t) => t.id),
      tagsForPaths(pathsIn(prd)),
      actorUserId,
    );
    const hash = checkFactsHash(prd);
    const kinds = requiredChecks(tags.map((t) => t.id)).filter(
      (k) => !only || k === only,
    );
    const existing = await this.list(plan.id);
    for (const kind of kinds) {
      const row = existing.find((r) => r.kind === kind);
      if (row && row.factsHash === hash && row.status !== 'failed' && !only)
        continue;
      await this.runOne(
        plan,
        prd,
        tags.map((t) => t.id),
        kind,
        hash,
        actorUserId,
        row,
      );
    }
    return tags;
  }

  /** Resolve one finding. The reason is required and visible to every later lead. */
  async resolve(
    plan: PlanSession,
    actorUserId: number,
    kind: PlanCheckKind,
    findingId: string,
    resolution: { kind: 'fixed' | 'dismissed'; reason: string },
  ): Promise<PlanCheck> {
    if (plan.leadUserId !== actorUserId) {
      throw new ForbiddenException(
        'Only this plan’s lead can resolve findings.',
      );
    }
    const row = await this.checks.findOne({
      where: { sessionId: plan.id, kind },
    });
    if (!row) throw new NotFoundException('Check not found');
    const finding = row.findings.find((f) => f.id === findingId);
    if (!finding) throw new NotFoundException('Finding not found');
    const reason = resolution.reason.trim();
    if (finding.severity === 'high' && reason.length < HIGH_REASON_MIN) {
      throw new BadRequestException(
        'This is a high-severity finding. Explain how it is handled, in a sentence or two.',
      );
    }
    if (!reason) throw new BadRequestException('Give a reason.');
    finding.resolution = {
      kind: resolution.kind,
      reason,
      by: actorUserId,
      at: new Date().toISOString(),
    };
    row.status = row.findings.every((f) => f.resolution)
      ? 'resolved'
      : 'findings';
    await this.checks.save(row);
    await this.events.record({
      sessionId: plan.id,
      kind:
        resolution.kind === 'dismissed'
          ? PlanEventKind.FINDING_DISMISSED
          : PlanEventKind.CHECK_RESOLVED,
      actorUserId,
      detail: { check: kind, findingId, severity: finding.severity, reason },
    });
    return row;
  }

  private async runOne(
    plan: PlanSession,
    prd: unknown,
    tags: string[],
    kind: PlanCheckKind,
    hash: string,
    actorUserId: number,
    previous: PlanCheck | undefined,
  ): Promise<void> {
    const ranBefore = await this.checks.count({ where: { kind } });
    const mode =
      previous?.mode ?? (ranBefore < SHADOW_PLANS ? 'shadow' : 'live');
    const row =
      previous ??
      this.checks.create({
        sessionId: plan.id,
        kind,
        status: 'running',
        mode,
        findings: [],
      });
    row.status = 'running';
    row.factsHash = hash;
    row.error = null;
    await this.checks.save(row);

    try {
      const out = await this.ai.json<{
        findings?: {
          severity?: string;
          title?: string;
          detail?: string;
          mitigation?: string;
        }[];
        inventory?: string;
      }>({
        promptCode: PROMPT[kind],
        payload: JSON.stringify({ impactTags: tags, prd }, null, 2).slice(
          0,
          120_000,
        ),
        maxTokens: 4000,
        sessionId: plan.id,
        stage: PlanStage.PRD,
        actorUserId,
        specialist: `${kind}_reviewer`,
      });
      if (!out)
        throw new Error('The reviewer did not return a readable answer.');
      const findings: PlanCheckFinding[] = (out.findings ?? [])
        .filter((f) => f?.title)
        .slice(0, 20)
        .map((f) => ({
          id: randomUUID(),
          severity:
            f.severity === 'high' || f.severity === 'medium'
              ? f.severity
              : 'low',
          title: String(f.title).slice(0, 200),
          detail: String(f.detail ?? '').slice(0, 4000),
          mitigation: f.mitigation
            ? String(f.mitigation).slice(0, 2000)
            : undefined,
          resolution: null,
        }));
      if (out.inventory) {
        findings.unshift({
          id: randomUUID(),
          severity: 'low',
          title: 'Data inventory',
          detail: String(out.inventory).slice(0, 4000),
          resolution: {
            kind: 'fixed',
            reason: 'Inventory recorded for reference.',
            by: actorUserId,
            at: new Date().toISOString(),
          },
        });
      }
      row.findings = findings;
      row.status = findings.every((f) => f.resolution)
        ? 'resolved'
        : 'findings';
      await this.checks.save(row);
      await this.events.record({
        sessionId: plan.id,
        kind: PlanEventKind.CHECK_REQUIRED,
        actorUserId,
        detail: { check: kind, findings: findings.length, mode: row.mode },
      });
      const high = findings.filter(
        (f) => f.severity === 'high' && !f.resolution,
      ).length;
      if (high) {
        await this.notifications.notify(
          plan.leadUserId,
          plan.id,
          PlanNotificationKind.CHECK_FINDING,
          `The ${kind.replace('_', ' ')} check found ${high} high-severity issue${high > 1 ? 's' : ''} in "${plan.title}".`,
        );
      }
    } catch (error) {
      row.status = 'failed';
      row.error = (error as Error)?.message ?? 'The check failed.';
      await this.checks.save(row);
    }
  }
}
