import { Injectable } from '@nestjs/common';
import { BuilderMessageRepository } from 'src/builder/repository/builder-message.repository';
import { BuilderSessionVisibility } from 'src/builder/enum/builder.enum';
import { PlanAccessService } from 'src/product-planning/service/plan-access.service';
import { PlanEventService } from 'src/product-planning/service/plan-event.service';
import { PlanSpendService } from 'src/product-planning/service/plan-spend.service';
import { PlanSettingsService } from 'src/product-planning/service/plan-settings.service';
import { PlanSession } from './plan-session.store';

const DAY_MS = 24 * 60 * 60 * 1000;

/** What every plan screen reads. */
export interface PlanView {
  id: string;
  title: string;
  stage: string | null;
  private: boolean;
  parked: boolean;
  archivedAt: string | null;
  /** When an unfiled draft is archived, or purged once archived. */
  expiresAt: string | null;
  authorUserId: number;
  leadUserId: number | null;
  opportunityId: string | null;
  canEdit: boolean;
  canLead: boolean;
  idea: {
    gates: { id: string; met: boolean; note?: string }[];
    draft: {
      description: string;
      productGoal: string | null;
      effort: string | null;
    } | null;
    readyToFile: boolean;
  };
  messages: {
    id: string;
    role: 'author' | 'agent';
    content: string;
    createdBy: number | null;
    createdAt: string;
    stage: string;
  }[];
  events: {
    kind: string;
    actorUserId: number | null;
    detail: unknown;
    at: string;
  }[];
  spend: {
    totalUsd: number;
    approximate: boolean;
    ceilingUsd: number;
    byStage: { key: string | null; costUsd: number }[];
    byActor: { actorUserId: number | null; costUsd: number }[];
  } | null;
}

/**
 * Renders a plan for a viewer. Callers have already checked the viewer may
 * read it. What differs by viewer: the author of a filed plan sees the spend
 * of their own turns only (rev 5.2 decision 7); a lead sees all of it.
 */
@Injectable()
export class PlanViewService {
  constructor(
    private readonly messages: BuilderMessageRepository,
    private readonly access: PlanAccessService,
    private readonly events: PlanEventService,
    private readonly spend: PlanSpendService,
    private readonly settings: PlanSettingsService,
  ) {}

  async render(plan: PlanSession, viewerId: number): Promise<PlanView> {
    const record = plan.plan ?? {};
    const isPrivate = plan.visibility === BuilderSessionVisibility.PRIVATE;
    const [rows, events, summary, canEdit, canLead, settings] =
      await Promise.all([
        this.messages.listBySession(plan.id),
        this.events.listForSession(plan.id),
        this.spend.summarize(plan.id),
        this.access.canEdit(plan, viewerId),
        this.access.canLead(viewerId),
        this.settings.get(),
      ]);

    const seeAllSpend = canLead || isPrivate;
    const spend = seeAllSpend
      ? summary
      : {
          ...summary,
          totalUsd: summary.byActor
            .filter((a) => a.actorUserId === viewerId)
            .reduce((sum, a) => sum + a.costUsd, 0),
          byStage: [],
          byActor: summary.byActor.filter((a) => a.actorUserId === viewerId),
        };

    const idea = record.idea ?? {};
    const gates = idea.gates ?? [];
    return {
      id: plan.id,
      title: plan.title,
      stage: plan.planStage ?? null,
      private: isPrivate,
      parked: !!record.parked,
      archivedAt: plan.archivedAt ? plan.archivedAt.toISOString() : null,
      expiresAt: isPrivate ? this.expiresAt(plan) : null,
      authorUserId: plan.createdBy,
      leadUserId: plan.leadUserId ?? null,
      opportunityId: record.opportunityId ?? null,
      canEdit,
      canLead,
      idea: {
        gates,
        draft: idea.draft ?? null,
        readyToFile:
          !!idea.draft &&
          !!idea.readinessToken &&
          gates.length > 0 &&
          gates.every((g) => g.met),
      },
      messages: rows
        .filter((m) => m.content && !m.metadata?.streaming)
        .map((m) => ({
          id: m.id,
          role: m.role === 'user' ? ('author' as const) : ('agent' as const),
          content: m.content ?? '',
          createdBy: m.createdBy ?? null,
          createdAt:
            (m as unknown as { createdAt: Date }).createdAt?.toISOString?.() ??
            '',
          stage: (m.metadata?.planStage as string) ?? 'prd',
        })),
      events: events.map((e) => ({
        kind: e.kind,
        actorUserId: e.actorUserId ?? null,
        detail: e.detail ?? null,
        at: e.at.toISOString(),
      })),
      spend: {
        totalUsd: Number(spend.totalUsd.toFixed(4)),
        approximate: spend.approximate,
        ceilingUsd: isPrivate ? settings.ideaCeilingUsd : settings.ceilingUsd,
        byStage: spend.byStage,
        byActor: spend.byActor,
      },
    };
  }

  /** Archive 30 days after last activity; purge 60 days after archiving (rev 5.2 decision 8). */
  expiresAt(plan: PlanSession): string {
    if (plan.archivedAt) {
      return new Date(
        plan.archivedAt.getTime() + PURGE_AFTER_ARCHIVE_DAYS * DAY_MS,
      ).toISOString();
    }
    const last = new Date(plan.plan?.lastActiveAt ?? plan.createdAt).getTime();
    return new Date(last + ARCHIVE_AFTER_DAYS * DAY_MS).toISOString();
  }
}

export const ARCHIVE_AFTER_DAYS = 30;
export const PURGE_AFTER_ARCHIVE_DAYS = 60;
export const WARN_DAYS_BEFORE = 7;
