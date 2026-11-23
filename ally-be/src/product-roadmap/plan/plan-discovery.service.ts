import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { MoreThan, Repository } from 'typeorm';
import { BuilderEvidenceService } from 'src/builder/service/builder-evidence.service';
import { BuilderSessionService } from 'src/builder/service/builder-session.service';
import { PlanSuggestion } from 'src/product-planning/entity/plan-suggestion.entity';
import { PlanStage } from 'src/product-planning/enum/product-planning.enum';
import { PlanAccessService } from 'src/product-planning/service/plan-access.service';
import { PlanSettingsService } from 'src/product-planning/service/plan-settings.service';
import type { PlanResearchPlan } from 'src/product-planning/type/plan-record.type';
import { RoadmapOpportunity } from '../entity/roadmap-opportunity.entity';
import { PlanAiService, PLANNING_PROMPTS } from './plan-ai.service';
import { PlanIdeaService } from './plan-idea.service';
import { PlanSessionStore } from './plan-session.store';
import { PlanView } from './plan-view.service';

const DAY_MS = 24 * 60 * 60 * 1000;
/** A dismissed suggestion stays quiet this long (rev 5.2 §B.15). */
export const SUPPRESS_DAYS = 90;
/** At most this many new suggestions per weekly run. */
export const SUGGESTIONS_PER_RUN = 5;

/** Lower-case words only, for suppression and de-duplication. Pure. */
export function suggestionFingerprint(title: string): string {
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .sort();
  return createHash('sha256')
    .update(words.join(' '))
    .digest('hex')
    .slice(0, 64);
}

/**
 * Discovery (rev 5.2 §B.8.3, P10): the research planner, which turns a plan's
 * riskiest assumption into a real-user test, and the weekly signal scout,
 * which suggests ideas from aggregated signals. Neither files, votes or
 * contacts anyone; a person acts on what they produce.
 */
@Injectable()
export class PlanDiscoveryService {
  constructor(
    private readonly store: PlanSessionStore,
    private readonly ai: PlanAiService,
    private readonly evidence: BuilderEvidenceService,
    private readonly builderSessions: BuilderSessionService,
    private readonly ideas: PlanIdeaService,
    private readonly access: PlanAccessService,
    private readonly settings: PlanSettingsService,
    @InjectRepository(PlanSuggestion)
    private readonly suggestions: Repository<PlanSuggestion>,
    @InjectRepository(RoadmapOpportunity)
    private readonly opportunities: Repository<RoadmapOpportunity>,
  ) {}

  async researchPlan(
    sessionId: string,
    userId: number,
  ): Promise<PlanResearchPlan> {
    await this.settings.assertEnabled();
    const plan = await this.store.get(sessionId);
    if (plan.leadUserId !== userId)
      throw new ForbiddenException(
        'Only this plan’s lead can plan its research.',
      );
    const detail = await this.builderSessions.getSessionDetail(
      sessionId,
      plan.createdBy,
    );
    const out = await this.ai.json<Partial<PlanResearchPlan>>({
      promptCode: PLANNING_PROMPTS.RESEARCH_PLAN,
      payload: JSON.stringify({ title: plan.title, prd: detail.prd }).slice(
        0,
        120_000,
      ),
      maxTokens: 3000,
      sessionId,
      stage: PlanStage.PRD,
      actorUserId: userId,
      specialist: 'research_planner',
    });
    const research: PlanResearchPlan = {
      assumption: String(out?.assumption ?? '').slice(0, 1000),
      who: String(out?.who ?? '').slice(0, 1000),
      questions: (out?.questions ?? [])
        .slice(0, 5)
        .map((q) => String(q).slice(0, 500)),
      alternativeTest: String(out?.alternativeTest ?? '').slice(0, 2000),
      decisionRule: String(out?.decisionRule ?? '').slice(0, 1000),
      draftedAt: new Date().toISOString(),
    };
    await this.store.patchPlan(sessionId, { research });
    return research;
  }

  async listSuggestions(userId: number): Promise<PlanSuggestion[]> {
    await this.settings.assertEnabled();
    await this.access.assertLead(userId);
    return this.suggestions.find({
      where: { status: 'open' },
      order: { createdAt: 'DESC' },
      take: 50,
    });
  }

  async dismiss(id: string, userId: number): Promise<void> {
    await this.settings.assertEnabled();
    await this.access.assertLead(userId);
    const result = await this.suggestions.update(
      { id, status: 'open' },
      { status: 'dismissed', decidedBy: userId, decidedAt: new Date() },
    );
    if (!result.affected) throw new NotFoundException('Suggestion not found');
  }

  /** Start a private plan from a suggestion, for the Lead who chose it. */
  async workUp(id: string, userId: number): Promise<PlanView> {
    await this.access.assertLead(userId);
    const suggestion = await this.suggestions.findOne({
      where: { id, status: 'open' },
    });
    if (!suggestion) throw new NotFoundException('Suggestion not found');
    const view = await this.ideas.start(userId, {
      text: `${suggestion.title}\n\n${suggestion.problem}\n\nWho: ${suggestion.who}\nWhy now: ${suggestion.whyNow}`,
      park: true,
    });
    await this.suggestions.update(
      { id },
      {
        status: 'worked_up',
        decidedBy: userId,
        decidedAt: new Date(),
        sessionId: view.id,
      },
    );
    return view;
  }

  /** Weekly: suggest up to five ideas from aggregated signals. */
  async scout(now = new Date()): Promise<number> {
    const settings = await this.settings.get();
    if (!settings.enabled) return 0;
    const [ux, findings, errors, board] = await Promise.all([
      this.evidence.uxSignals().catch(() => null),
      this.evidence.openFindings().catch(() => null),
      this.evidence.prodErrors('ally-be').catch(() => null),
      this.opportunities.find({
        select: { id: true, description: true },
        order: { createdAt: 'DESC' },
        take: 200,
      }),
    ]);
    const out = await this.ai.json<{
      suggestions?: {
        title?: string;
        problem?: string;
        who?: string;
        evidence?: string[];
        whyNow?: string;
      }[];
    }>({
      promptCode: PLANNING_PROMPTS.SIGNAL_SCOUT,
      payload: JSON.stringify({
        uxSignals: ux,
        bugFindings: findings,
        productionErrors: errors,
        existingRoadmap: board.map((o) => o.description.slice(0, 160)),
      }).slice(0, 120_000),
      maxTokens: 4000,
      sessionId: null,
      stage: null,
      actorUserId: null,
      specialist: 'signal_scout',
    });
    const recent = await this.suggestions.find({
      where: {
        createdAt: MoreThan(new Date(now.getTime() - SUPPRESS_DAYS * DAY_MS)),
      },
      select: { fingerprint: true, status: true },
    });
    const blocked = new Set(recent.map((r) => r.fingerprint));
    let created = 0;
    for (const s of (out?.suggestions ?? []).slice(0, SUGGESTIONS_PER_RUN)) {
      if (!s?.title || !s.problem) continue;
      const fingerprint = suggestionFingerprint(s.title);
      if (blocked.has(fingerprint)) continue;
      blocked.add(fingerprint);
      await this.suggestions.save(
        this.suggestions.create({
          title: String(s.title).slice(0, 200),
          problem: String(s.problem).slice(0, 4000),
          who: String(s.who ?? '').slice(0, 1000),
          evidence: (s.evidence ?? [])
            .slice(0, 20)
            .map((e) => String(e).slice(0, 200)),
          whyNow: String(s.whyNow ?? '').slice(0, 2000),
          fingerprint,
          status: 'open',
        }),
      );
      created++;
    }
    return created;
  }
}
