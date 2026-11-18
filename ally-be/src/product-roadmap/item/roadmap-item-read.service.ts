import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { BuilderDecisionService } from 'src/builder/service/builder-decision.service';
import { BuilderSessionService } from 'src/builder/service/builder-session.service';
import type { BuilderDecision } from 'src/builder/type/builder-decision.type';
import { LoggerService } from 'src/logger/logger.service';
import {
  PlanEventKind,
  RoadmapNotificationKind,
  RoadmapWatchLevel,
} from 'src/product-planning/enum/product-planning.enum';
import { PlanCeilingService } from 'src/product-planning/service/plan-ceiling.service';
import { RoadmapRoleService } from 'src/product-planning/service/roadmap-role.service';
import {
  deriveItemStage,
  ItemStage,
  simpleStageOf,
} from 'src/product-planning/util/plan-stage.util';
import {
  capabilitiesFor,
  editCapabilitiesFor,
  roleAtLeast,
  RoadmapRole,
} from 'src/product-planning/util/roadmap-role.util';
import {
  RoadmapOpportunityRepository,
  RoadmapOpportunityRow,
} from '../repository/roadmap-opportunity.repository';
import { RoadmapStrategyGoalService } from '../service/roadmap-strategy-goal.service';
import { currentPeriodKey } from '../util/roadmap-period.util';
import { PlanSessionStore } from '../plan/plan-session.store';
import {
  PlanSessionDetail,
  PlanStageService,
} from '../plan/plan-stage.service';
import { RoadmapItemLookupService } from './roadmap-item-lookup.service';
import {
  ciState,
  itemStageFacts,
  latest,
  mergePrs,
  OpportunityFacts,
  PlanningFacts,
  PrFact,
  ReleaseFact,
  SessionFacts,
  stageSinceOf,
  toIso,
} from './roadmap-item-facts.util';
import {
  bodyOf,
  codeDigits,
  compareRows,
  ItemQuery,
  ItemQueryFacts,
  matchesFilters,
  page,
  titleOf,
} from './roadmap-item-query.util';
import {
  ForYouSections,
  ItemDesignState,
  ItemDetail,
  ItemListResponse,
  ItemOrigin,
  ItemRelation,
  ItemRow,
  ItemTimelineEntry,
  ItemTimelineKind,
  ItemSearchResponse,
  PersonRef,
  ToTriageSections,
  WhyHere,
  WhyHereDecision,
} from './roadmap-item.types';

const DAY_MS = 86_400_000;
/** Recently shipped, in For you (§4.3). */
const RECENTLY_SHIPPED_DAYS = 14;
/** One section of For you or To triage never returns more than this. */
const SECTION_MAX = 50;
/** To triage is the whole Backlog, so it is not cut at the small per-section limit the other views use. */
const TRIAGE_SECTION_MAX = 500;
/** Quick open (§4.11). */
const SEARCH_MAX = 20;
const RECENT_MAX = 5;
/** The pending-decision snapshot is shared across requests this long. */
const DECISIONS_TTL_MS = 15_000;
/** The board read pages through the repository this many rows at a time (its MAX_LIMIT). */
const BASE_PAGE = 500;
const BASE_MAX_ROWS = 5000;

/** Builder decision kinds as the queue's why-here. */
const DECISION_WHY: Partial<Record<string, WhyHereDecision>> = {
  design_review: 'approveDesign',
  pr_merge: 'merge',
  budget: 'budget',
  start_build: 'startBuild',
  pr_needs_human: 'unblock',
  build_failed: 'unblock',
};
const QUESTION_KINDS = ['question', 'brief'];

/** The plan events an idea's timeline shows: milestones, not housekeeping. */
const TIMELINE_EVENT_KINDS: string[] = [
  PlanEventKind.FILED,
  PlanEventKind.REVIEWED,
  PlanEventKind.PLANNING_STARTED,
  PlanEventKind.PLAN_CLOSED,
  PlanEventKind.PLAN_REOPENED,
  PlanEventKind.LEAD_ASSIGNED,
  PlanEventKind.LEAD_HANDED_BACK,
  PlanEventKind.DESIGN_APPROVED,
  PlanEventKind.BUILD_SENT,
  PlanEventKind.EXTERNAL_BUILD,
  PlanEventKind.BUILD_MODE_SET,
  PlanEventKind.MARKED_RELEASED,
  PlanEventKind.CLOSED,
  PlanEventKind.REOPENED,
  PlanEventKind.ITEM_EDITED,
  PlanEventKind.ANSWER_SETTLED,
];

interface Notice {
  kind: string;
  createdAt: string;
  byUserId: number | null;
}

interface OpenAsk {
  questionId: string;
  content: string;
  createdAt: string;
}

/** Everything the read model knows about one idea for one caller. */
interface ItemCore extends ItemQueryFacts {
  description: string;
  opp: OpportunityFacts & {
    updatedAt: string;
    planStageAt: string | null;
    declineReason: string | null;
    starredById: number | null;
    voterCount: number;
    goalsHelped: number;
    goalsAssessed: number;
    referenceImages: string[];
    productGoal: string;
  };
  goalName: string | null;
  session: SessionFacts | null;
  stage: ItemStage;
  prs: PrFact[];
  releases: ReleaseFact[];
  decisions: BuilderDecision[];
  asks: OpenAsk[];
  notices: Notice[];
  watchLevel: RoadmapWatchLevel;
  unread: boolean;
  votedByMe: boolean;
}

type CoreSections<T> = { [K in keyof T]: ItemCore[] };

/** What one request has loaded. */
interface Loaded {
  userId: number;
  role: RoadmapRole;
  cores: ItemCore[];
}

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
const clip = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};
const asJson = <T>(value: unknown): T | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }
  return value as T;
};

/**
 * The Roadmap v2 read model (plans/roadmap-builder-merge §5.2): one idea for
 * the idea page, the queue's role-scoped views, and quick open. Reads only;
 * every route that calls it has already checked `roadmap_v2`.
 *
 * Rows are built from the board's own projection
 * (RoadmapOpportunityRepository.listOpportunities), so votes, the composite
 * and the queue rank are the numbers the board shows, plus one query for the
 * v2 facts. The whole board is loaded and filtered in memory: it is a few
 * hundred rows (ROADMAP_LIST_DEFAULTS.MAX_LIMIT), and a view's sections,
 * filters and why-here all read facts no single SQL predicate holds.
 */
@Injectable()
export class RoadmapItemReadService {
  private readonly logger = LoggerService.getInstance(
    RoadmapItemReadService.name,
  );
  private decisionsCache: {
    at: number;
    value: Promise<BuilderDecision[]>;
  } | null = null;

  constructor(
    private readonly dataSource: DataSource,
    private readonly opportunities: RoadmapOpportunityRepository,
    private readonly strategyGoals: RoadmapStrategyGoalService,
    private readonly roles: RoadmapRoleService,
    private readonly decisions: BuilderDecisionService,
    private readonly builderSessions: BuilderSessionService,
    private readonly planStore: PlanSessionStore,
    private readonly planStage: PlanStageService,
    private readonly ceiling: PlanCeilingService,
    private readonly lookup: RoadmapItemLookupService,
  ) {}

  // ── Views ──────────────────────────────────────────────────────────────────

  async list(userId: number, query: ItemQuery): Promise<ItemListResponse> {
    const role = await this.roles.roleOf(userId);
    if (role === 'none') throw this.noAccess();
    if (query.view === 'leading' && !roleAtLeast(role, 'builder')) {
      throw new ForbiddenException(
        'The Leading view is for Builders and Owners.',
      );
    }
    if (query.view === 'to-triage' && role !== 'owner') {
      throw new ForbiddenException('To triage is for Owners.');
    }
    const loaded = await this.loadAll(userId, role);
    let visible = loaded.cores.filter((c) => matchesFilters(c, query.filters));
    // Filters about the person asking: ideas they lead, wrote, or that wait on them.
    const f = query.filters;
    if (f.ledByMe) visible = visible.filter((c) => c.leadId === userId);
    if (f.wroteByMe) visible = visible.filter((c) => c.authorId === userId);
    if (f.needsYou) {
      visible = visible
        .filter((c) => c.shownStage !== 'declined' && c.shownStage !== 'closed')
        .map((c) => ({ ...c, whyHere: this.needsYouWhy(loaded, c) }))
        .filter((c) => !!c.whyHere);
    }
    const order = compareRows(query.sort);

    if (query.view === 'for-you') {
      const sections = this.forYou(loaded, visible);
      const out = {} as ForYouSections;
      for (const key of Object.keys(sections) as (keyof ForYouSections)[]) {
        out[key] = await this.toRows(
          loaded,
          sections[key].sort(order).slice(0, SECTION_MAX),
        );
      }
      return { sections: out };
    }

    if (query.view === 'to-triage') {
      const sections = this.toTriage(visible);
      const out = {} as ToTriageSections;
      for (const key of Object.keys(sections) as (keyof ToTriageSections)[]) {
        out[key] = await this.toRows(
          loaded,
          sections[key].sort(order).slice(0, TRIAGE_SECTION_MAX),
        );
      }
      return { sections: out };
    }

    const rows =
      query.view === 'leading'
        ? visible
            .filter(
              (c) =>
                c.leadId === userId &&
                c.shownStage !== 'declined' &&
                c.shownStage !== 'closed',
            )
            .map((c) => ({ ...c, whyHere: this.needsYouWhy(loaded, c) }))
        : visible;
    const sorted = [...rows].sort(order);
    const paged = page(sorted, query.offset, query.limit);
    return { ...paged, rows: await this.toRows(loaded, paged.rows) };
  }

  /**
   * Queue rows for these ideas, in the order given (P3: similar ideas, the
   * review batch's answer). Ids that are not on the board are left out.
   */
  async rowsFor(userId: number, ids: string[]): Promise<ItemRow[]> {
    if (!ids.length) return [];
    const role = await this.roles.roleOf(userId);
    if (role === 'none') throw this.noAccess();
    const loaded = await this.loadAll(userId, role);
    const byId = new Map(loaded.cores.map((c) => [c.id, c]));
    const cores = ids
      .map((id) => byId.get(id))
      .filter((c): c is ItemCore => !!c);
    return this.toRows(loaded, cores);
  }

  /** Quick open: by code, title or author; the caller's recent ideas when empty. */
  async search(userId: number, q: string): Promise<ItemSearchResponse> {
    const role = await this.roles.roleOf(userId);
    if (role === 'none') throw this.noAccess();
    const loaded = await this.loadAll(userId, role);
    const needle = (q ?? '').trim().slice(0, 200);
    if (needle) {
      const digits = codeDigits(needle);
      const hits = loaded.cores
        .filter((c) => matchesFilters(c, { q: needle }))
        .sort(
          (a, b) =>
            Number(codeDigits(b.code) === digits) -
              Number(codeDigits(a.code) === digits) ||
            compareRows('rank')(a, b),
        )
        .slice(0, SEARCH_MAX);
      return { items: await this.toRows(loaded, hits), recent: [] };
    }
    const seen: { itemId: string }[] = await this.dataSource.query(
      `SELECT "itemId" FROM "roadmap_item_reads"
        WHERE "userId" = $1 ORDER BY "lastSeenAt" DESC LIMIT 20`,
      [userId],
    );
    const byId = new Map(loaded.cores.map((c) => [c.id, c]));
    const recent: ItemCore[] = [];
    for (const { itemId } of seen) {
      const core = byId.get(itemId);
      if (core && !recent.includes(core)) recent.push(core);
      if (recent.length >= RECENT_MAX) break;
    }
    if (recent.length < RECENT_MAX) {
      const own = loaded.cores
        .filter((c) => c.authorId === userId && !recent.includes(c))
        .sort(compareRows('newest'));
      recent.push(...own.slice(0, RECENT_MAX - recent.length));
    }
    return { items: [], recent: await this.toRows(loaded, recent) };
  }

  // ── One idea ───────────────────────────────────────────────────────────────

  async detail(userId: number, idOrCode: string): Promise<ItemDetail> {
    const role = await this.roles.roleOf(userId);
    if (role === 'none') throw this.noAccess();
    const ref = await this.lookup.get(idOrCode);
    const base = await this.opportunities.findOneWithScore(
      ref.id,
      userId,
      currentPeriodKey(),
      await this.strategyGoals.getRankContext(),
    );
    if (!base || base.type === 'bug') {
      throw new NotFoundException('Idea not found');
    }

    const sessionId = base.builderSessionId ?? null;
    const [sessionDetail, sessionDecisions] = sessionId
      ? await Promise.all([
          this.sessionDetail(sessionId),
          this.decisions.listPendingForSession(sessionId).catch(() => []),
        ])
      : [null, []];
    const [core] = await this.buildCores(userId, [base], {
      decisions: sessionDecisions,
      detail: sessionDetail,
    });
    const loaded: Loaded = { userId, role, cores: [core] };
    const [row] = await this.toRows(loaded, [core]);

    const isAuthor = core.authorId === userId;
    const isLead = core.leadId === userId;
    const session = core.session;
    const viewer = role === 'viewer';
    const design = this.designState(sessionDetail);
    const can = {
      ...capabilitiesFor(
        role,
        { isAuthor, isLead, isWatcher: core.watchLevel !== 'none' },
        {
          shownStage: core.shownStage,
          hasLead: core.leadId !== null,
          hasPlan: session?.kind === 'plan',
          planningStarted:
            core.shownStage !== 'submitted' && core.shownStage !== 'accepted',
          planClosed: !!session?.planClosed?.at,
          designAwaitingApproval:
            design === 'awaitingApproval' ||
            core.decisions.some((d) => d.kind === 'design_review'),
          readyToBuild:
            core.stage.statusParts.stage === 'planning' &&
            core.stage.statusParts.step === 'ready',
          awaitingMerge: core.decisions.some((d) => d.kind === 'pr_merge'),
          releaseHeld: false,
          answersConflict: (session?.openConflicts ?? 0) > 0,
        },
      ),
      ...editCapabilitiesFor(role, { isAuthor, isLead }, core.shownStage, {
        planClosed: !!session?.planClosed?.at,
        hasLead: core.leadId !== null,
      }),
    };

    const [runs, spend, outcome, people, history] = await Promise.all([
      session && !viewer ? this.runs(session.id) : Promise.resolve([]),
      session && !viewer ? this.spend(session) : Promise.resolve(undefined),
      session && !viewer
        ? this.outcome(session.id)
        : Promise.resolve(undefined),
      this.people(core),
      this.history(core, session?.id ?? null),
    ]);

    const brief = asJson<{
      reach?: { howMany?: string | null; howOften?: string | null };
      successMetric?: string | null;
      assessment?: { rating?: string };
    }>(base.brief);
    const who = [brief?.reach?.howMany, brief?.reach?.howOften]
      .filter((v): v is string => !!v && !!v.trim())
      .join(' · ');

    const reviewState = (core.opp.reviewState ?? 'accepted') as
      | 'pending'
      | 'accepted'
      | 'declined';

    const detail: ItemDetail = {
      ...row,
      summary: {
        ...(bodyOf(core.description)
          ? { problem: bodyOf(core.description) as string }
          : {}),
        ...(who ? { who } : {}),
        ...(brief?.successMetric ? { outcome: brief.successMetric } : {}),
        whyRanks: {
          queueRank: core.queueRank,
          compositeScore: core.compositeScore,
          votes: core.votes,
          voters: core.opp.voterCount,
          goalsHelped: core.opp.goalsHelped,
          goalsAssessed: core.opp.goalsAssessed,
          starred: core.starred,
          rating: brief?.assessment?.rating ?? null,
        },
        images: core.opp.referenceImages,
      },
      ...(session && !viewer ? { sessionId: session.id } : {}),
      ...(sessionDetail && !viewer
        ? {
            prd: {
              readinessPct: Math.round(
                num(sessionDetail.readiness?.score ?? 0),
              ),
              versionNumber: num(sessionDetail.prdVersionNumber),
            },
            design: { state: design },
          }
        : {}),
      runs,
      prs: core.prs.map((pr) => ({
        repo: pr.repo,
        number: pr.number,
        url: pr.url,
        state: pr.state,
        ...(pr.ci !== 'unknown' ? { ci: pr.ci } : {}),
      })),
      releases: core.releases.map((r) => ({
        service: r.service,
        state: r.state,
        repo: r.repo,
        prNumber: r.prNumber,
        ...(r.tag ? { tag: r.tag } : {}),
        ...(r.releasedAt ? { releasedAt: r.releasedAt } : {}),
      })),
      ...(outcome ? { outcome } : {}),
      ...(spend ? { spend } : {}),
      people,
      can,
      watchLevel: core.watchLevel,
      reviewState,
      ...(core.shownStage === 'declined' &&
      core.opp.declineReason &&
      (isAuthor || role === 'owner')
        ? { declineReason: core.opp.declineReason }
        : {}),
      ...(history.origin ? { origin: history.origin } : {}),
      timeline: history.timeline,
    };
    return detail;
  }

  /**
   * The idea's one history (lifecycle 2026-11-18): where it started and every
   * milestone since, from the plan events, the filing and the release rows.
   * Read-only, and open to everyone who can read the idea.
   */
  private async history(
    core: ItemCore,
    sessionId: string | null,
  ): Promise<{ origin: ItemOrigin | null; timeline: ItemTimelineEntry[] }> {
    const [sessionRows, eventRows] = sessionId
      ? await Promise.all([
          this.dataSource.query(
            `SELECT "createdAt", "createdBy", plan->>'captureMode' AS "captureMode",
                    plan->>'draftText' AS "draftText"
               FROM "builder_sessions" WHERE id = $1`,
            [sessionId],
          ) as Promise<Record<string, unknown>[]>,
          this.dataSource.query(
            `SELECT kind, "actorUserId", detail, "at" FROM "plan_events"
              WHERE "sessionId" = $1 AND kind = ANY($2::varchar[])
              ORDER BY "at" ASC, id ASC`,
            [sessionId, TIMELINE_EVENT_KINDS],
          ) as Promise<Record<string, unknown>[]>,
        ])
      : [[], []];
    const origin = sessionRows[0] ?? null;
    const events = eventRows.map((e) => ({
      at: toIso(e.at) ?? '',
      kind: String(e.kind),
      actorId: e.actorUserId == null ? null : Number(e.actorUserId),
      detail: asJson<Record<string, unknown>>(e.detail) ?? undefined,
    }));

    const ids: number[] = [core.authorId];
    if (origin?.createdBy != null) ids.push(Number(origin.createdBy));
    for (const e of events) {
      if (e.actorId) ids.push(e.actorId);
      if (e.kind === 'lead_assigned') {
        for (const key of ['from', 'to']) {
          const id = e.detail?.[key];
          if (typeof id === 'number' || typeof id === 'string') {
            ids.push(Number(id));
          }
        }
      }
    }
    const people = await this.resolvePeople(ids);
    const person = (id: number | null | undefined) =>
      id == null ? null : (people.get(Number(id)) ?? null);

    const timeline: ItemTimelineEntry[] = [];
    // Filing is recorded as a `filed` event by the guided flow. A session made
    // later for an older idea (to pick a builder, or to comment) also records
    // `filed`, with `detail.by`, at that later time and by that person: it is
    // not the submission, so the row's createdAt and author stand in for it.
    const isSubmission = (e: {
      kind: string;
      detail?: Record<string, unknown>;
    }) => e.kind === 'filed' && !e.detail?.by;
    const shown = events.filter((e) => e.kind !== 'filed' || isSubmission(e));
    if (!shown.some(isSubmission)) {
      const filedAt = toIso(core.opp.createdAt);
      if (filedAt) {
        timeline.push({
          at: filedAt,
          kind: 'submitted',
          actor: person(core.authorId),
        });
      }
    }
    for (const e of shown) {
      const kind: ItemTimelineKind =
        e.kind === 'filed' ? 'submitted' : (e.kind as ItemTimelineKind);
      const detail =
        e.kind === 'lead_assigned'
          ? {
              from: person(e.detail?.from as number | null),
              to: person(e.detail?.to as number | null),
            }
          : e.detail;
      timeline.push({
        at: e.at,
        kind,
        actor: person(e.actorId),
        ...(detail && Object.keys(detail).length ? { detail } : {}),
      });
    }
    for (const r of core.releases) {
      if (r.state !== 'live' || !r.releasedAt) continue;
      timeline.push({
        at: r.releasedAt,
        kind: 'release_live',
        actor: null,
        detail: { service: r.service, ...(r.tag ? { tag: r.tag } : {}) },
      });
    }
    timeline.sort((a, b) => a.at.localeCompare(b.at));

    return {
      origin: origin
        ? {
            startedAt: toIso(origin.createdAt) ?? '',
            startedBy: person(
              origin.createdBy == null ? null : Number(origin.createdBy),
            ),
            captureMode:
              origin.captureMode === 'voice' || origin.captureMode === 'typed'
                ? origin.captureMode
                : null,
            roughIdea:
              typeof origin.draftText === 'string' && origin.draftText.trim()
                ? origin.draftText
                : null,
          }
        : null,
      timeline,
    };
  }

  // ── Sections ───────────────────────────────────────────────────────────────

  /** For you (§4.3): sections in order; an idea shows in the first that claims it. */
  private forYou(
    loaded: Loaded,
    cores: ItemCore[],
  ): CoreSections<ForYouSections> {
    const { userId } = loaded;
    const taken = new Set<string>();
    const claim = (list: ItemCore[]) => {
      const out = list.filter((c) => !taken.has(c.id));
      out.forEach((c) => taken.add(c.id));
      return out;
    };
    const live = (c: ItemCore) =>
      c.shownStage !== 'declined' && c.shownStage !== 'closed';
    const cutoff = Date.now() - RECENTLY_SHIPPED_DAYS * DAY_MS;

    const needsYou = claim(
      cores
        .filter(live)
        .map((c) => ({ ...c, whyHere: this.needsYouWhy(loaded, c) }))
        .filter((c) => !!c.whyHere),
    );
    const progress = (c: ItemCore): ItemCore => ({
      ...c,
      whyHere:
        c.shownStage === 'shipped'
          ? { kind: 'shipped', at: c.stageSince }
          : c.unread
            ? { kind: 'progress' }
            : undefined,
    });
    const yourIdeas = claim(
      cores.filter((c) => c.authorId === userId).map(progress),
    );
    const watching = claim(
      cores
        .filter(
          (c) =>
            live(c) &&
            c.shownStage !== 'shipped' &&
            c.watchLevel !== RoadmapWatchLevel.NONE,
        )
        .map(progress),
    );
    const recentlyShipped = claim(
      cores
        .filter(
          (c) =>
            c.shownStage === 'shipped' && Date.parse(c.stageSince) >= cutoff,
        )
        .map((c) => ({
          ...c,
          whyHere: { kind: 'shipped' as const, at: c.stageSince },
        })),
    );
    return { needsYou, yourIdeas, watching, recentlyShipped };
  }

  /**
   * Why an idea needs the caller now, or undefined. The lead's decisions
   * first, then agent questions on ideas they wrote, lead or watch on All,
   * then answers to settle and @mentions addressed to them (§4.3, §4.8).
   */
  private needsYouWhy(loaded: Loaded, c: ItemCore): WhyHere | undefined {
    const { userId } = loaded;
    const isLead = c.leadId === userId;
    if (isLead) {
      for (const d of c.decisions) {
        const decision = DECISION_WHY[d.kind];
        if (decision) {
          return { kind: 'decision', decision, since: d.waitingSince };
        }
      }
    }
    const follows =
      c.authorId === userId || isLead || c.watchLevel === RoadmapWatchLevel.ALL;
    const phase = c.session?.planStage === 'idea' ? 'idea' : 'plan';
    if (follows) {
      const question = c.decisions.find((d) => QUESTION_KINDS.includes(d.kind));
      if (question) {
        return {
          kind: 'agentQuestion',
          phase,
          questionPreview: clip(question.prompt ?? '', 140),
          since: question.waitingSince,
        };
      }
    }
    if (c.authorId === userId && c.asks.length) {
      const ask = c.asks[0];
      return {
        kind: 'agentQuestion',
        phase,
        questionPreview: clip(ask.content, 140),
        since: ask.createdAt,
      };
    }
    const conflict = c.notices.find(
      (n) => n.kind === RoadmapNotificationKind.ANSWERS_CONFLICT,
    );
    if (conflict) {
      return {
        kind: 'decision',
        decision: 'settleAnswer',
        since: conflict.createdAt,
      };
    }
    const mention = c.notices.find(
      (n) => n.kind === RoadmapNotificationKind.MENTION,
    );
    if (mention) {
      return {
        kind: 'mention',
        // Resolved to a name and role in toRows.
        by: { id: mention.byUserId ?? 0, name: '', role: 'none' },
        since: mention.createdAt,
      };
    }
    return undefined;
  }

  /**
   * To do (§4.3, §4.6): every idea with no builder yet, as one list. The Owner's next move is the
   * idea's next step: Start planning (which accepts an unreviewed idea), Close plan, or assign a
   * builder once the plan is closed; or decline it. Ideas with a builder are Being built.
   */
  private toTriage(cores: ItemCore[]): CoreSections<ToTriageSections> {
    const backlog = cores
      .filter(
        (c) =>
          c.shownStage === 'submitted' ||
          // Lifecycle 2026-11-18: accepted and being planned stay To do until an
          // Owner assigns a builder, which only happens once the plan is closed.
          ((c.shownStage === 'accepted' || c.shownStage === 'planning') &&
            c.leadId === null),
      )
      .map((c) => ({
        ...c,
        whyHere:
          c.shownStage === 'submitted'
            ? { kind: 'awaitingReview' as const, since: c.stageSince }
            : { kind: 'needsLead' as const, since: c.stageSince },
      }));
    return { backlog };
  }

  // ── Loading ────────────────────────────────────────────────────────────────

  private async loadAll(userId: number, role: RoadmapRole): Promise<Loaded> {
    const periodKey = currentPeriodKey();
    const rank = await this.strategyGoals.getRankContext();
    const base: RoadmapOpportunityRow[] = [];
    for (let offset = 0; offset < BASE_MAX_ROWS; offset += BASE_PAGE) {
      const { items } = await this.opportunities.listOpportunities({
        userId,
        periodKey,
        rank,
        sortBy: 'composite',
        order: 'DESC',
        limit: BASE_PAGE,
        offset,
      });
      base.push(...items);
      if (items.length < BASE_PAGE) break;
    }
    const cores = await this.buildCores(userId, base, {
      decisions: await this.pendingDecisions(),
    });
    return { userId, role, cores };
  }

  /** Builder's pending decisions, shared across requests for a few seconds. */
  private pendingDecisions(): Promise<BuilderDecision[]> {
    const now = Date.now();
    if (
      !this.decisionsCache ||
      now - this.decisionsCache.at > DECISIONS_TTL_MS
    ) {
      const value = this.decisions.listPending().catch((error) => {
        this.logger.warn(
          `Could not read Builder decisions for the queue: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return [] as BuilderDecision[];
      });
      this.decisionsCache = { at: now, value };
    }
    return this.decisionsCache.value;
  }

  private async buildCores(
    userId: number,
    base: RoadmapOpportunityRow[],
    ctx: {
      decisions: BuilderDecision[];
      detail?: PlanSessionDetail | null;
    },
  ): Promise<ItemCore[]> {
    if (!base.length) return [];
    const ids = base.map((row) => row.id);
    const facts: Record<string, unknown>[] = await this.dataSource.query(
      `SELECT o.id,
              o."reviewState", o."reviewedBy", o."reviewedAt", o."declineReason",
              o."starredByUserId", o."planStageAt" AS "oppPlanStageAt",
              g.id AS "goalId", g.name AS "goalName",
              s.id AS "sessionId", s.kind AS "sessionKind", s.status AS "sessionStatus",
              s.visibility AS "sessionVisibility", s."createdBy" AS "sessionCreatedBy",
              s."leadUserId", s."planStage" AS "sessionPlanStage",
              s."planStageAt" AS "sessionPlanStageAt", s."updatedAt" AS "sessionUpdatedAt",
              s."lastRunSequence", s.repos AS "sessionRepos",
              s."totalCostUsd", s."budgetUsd",
              s.plan->'closed' AS "planClosed",
              s.plan->'launch'->>'launchedAt' AS "launchedAt",
              s.plan->'reviews' AS "planReviews",
              s.plan->'externalBuild' AS "externalBuild",
              s.plan->'planningStarted' AS "planningStarted",
              s.plan->'planClosed' AS "planClosedStamp",
              s.plan->'buildMode' AS "buildMode",
              s.plan->>'openConflicts' AS "openConflicts",
              w.level AS "watchLevel",
              r."lastSeenAt",
              EXISTS (SELECT 1 FROM "roadmap_allocations" a
                       WHERE a."opportunityId" = o.id AND a."userId" = $1 AND a.votes > 0
                     ) AS "votedByMe",
              (SELECT max(c."createdAt") FROM "roadmap_opportunity_comments" c
                WHERE c."opportunityId" = o.id AND c."deletedAt" IS NULL) AS "lastCommentAt"
         FROM "roadmap_opportunities" o
         LEFT JOIN "builder_sessions" s
                ON s.id = o."builderSessionId" AND s."deletedAt" IS NULL
         LEFT JOIN "roadmap_product_goals" g ON g.name = o."productGoal"
         LEFT JOIN "roadmap_watches" w ON w."itemId" = o.id AND w."userId" = $1
         LEFT JOIN "roadmap_item_reads" r ON r."itemId" = o.id AND r."userId" = $1
        WHERE o.id = ANY($2::uuid[])`,
      [userId, ids],
    );
    const factsById = new Map(facts.map((f) => [String(f.id), f]));
    const sessionIds = facts
      .map((f) => f.sessionId)
      .filter((id): id is string => typeof id === 'string');

    const [builderPrs, linkedPrs, releases, asks, notices, names] =
      await Promise.all([
        sessionIds.length
          ? this.dataSource.query(
              `SELECT "sessionId", repo, "prNumber", "prUrl", "ciStatus", state, merged
                 FROM "builder_pull_requests" WHERE "sessionId" = ANY($1::uuid[])`,
              [sessionIds],
            )
          : Promise.resolve([]),
        this.dataSource.query(
          `SELECT "opportunityId", repo, "prNumber", "prUrl", state
             FROM "item_linked_prs" WHERE "opportunityId" = ANY($1::uuid[])`,
          [ids],
        ),
        this.dataSource.query(
          `SELECT "opportunityId", repo, "prNumber", service, state, tag, "releasedAt"
             FROM "item_releases" WHERE "opportunityId" = ANY($1::uuid[])`,
          [ids],
        ),
        sessionIds.length
          ? this.dataSource.query(
              `SELECT m."sessionId", m.metadata->'askAuthor'->>'questionId' AS "questionId",
                      m.content, m."createdAt"
                 FROM "builder_messages" m
                WHERE m."sessionId" = ANY($1::uuid[])
                  AND m.metadata->'askAuthor'->>'questionId' IS NOT NULL
                  AND NOT EXISTS (
                    SELECT 1 FROM "builder_messages" a
                     WHERE a."sessionId" = m."sessionId"
                       AND a.metadata->'authorAnswer'->>'questionId'
                           = m.metadata->'askAuthor'->>'questionId')
                ORDER BY m."createdAt" ASC`,
              [sessionIds],
            )
          : Promise.resolve([]),
        this.dataSource.query(
          `SELECT "itemId", kind, "createdAt", payload->>'byUserId' AS "byUserId"
             FROM "roadmap_notifications"
            WHERE "recipientUserId" = $1 AND "readAt" IS NULL
              AND "itemId" = ANY($2::uuid[])
            ORDER BY "createdAt" ASC`,
          [userId, ids],
        ),
        this.dataSource.query(
          `SELECT id, name FROM "users" WHERE id = ANY($1::int[])`,
          [[...new Set(base.map((row) => Number(row.createdBy)))]],
        ),
      ]);

    const group = <T extends Record<string, unknown>>(
      rows: T[],
      key: string,
    ) => {
      const map = new Map<string, T[]>();
      for (const row of rows) {
        const k = String(row[key]);
        const list = map.get(k) ?? [];
        list.push(row);
        map.set(k, list);
      }
      return map;
    };
    const builderPrsBySession = group(builderPrs, 'sessionId');
    const linkedByOpp = group(linkedPrs, 'opportunityId');
    const releasesByOpp = group(releases, 'opportunityId');
    const asksBySession = group(asks, 'sessionId');
    const noticesByItem = group(notices, 'itemId');
    const decisionsBySession = group(
      ctx.decisions as unknown as Record<string, unknown>[],
      'sessionId',
    ) as unknown as Map<string, BuilderDecision[]>;
    const authorNames = new Map<number, string>(
      (names as { id: number; name: string | null }[]).map((u) => [
        Number(u.id),
        u.name ?? '',
      ]),
    );

    const cores: ItemCore[] = [];
    for (const row of base) {
      const f = factsById.get(row.id) ?? {};
      const session: SessionFacts | null = f.sessionId
        ? {
            id: String(f.sessionId),
            kind: String(f.sessionKind ?? ''),
            status: String(f.sessionStatus ?? ''),
            visibility: String(f.sessionVisibility ?? ''),
            createdBy: num(f.sessionCreatedBy),
            leadUserId: f.leadUserId == null ? null : num(f.leadUserId),
            planStage: (f.sessionPlanStage as string | null) ?? null,
            planStageAt: toIso(f.sessionPlanStageAt),
            updatedAt: toIso(f.sessionUpdatedAt),
            lastRunSequence: num(f.lastRunSequence),
            repos: Array.isArray(asJson(f.sessionRepos))
              ? (asJson<string[]>(f.sessionRepos) as string[])
              : [],
            closed: asJson(f.planClosed),
            launchedAt: (f.launchedAt as string | null) ?? null,
            reviews: asJson(f.planReviews),
            externalBuild: asJson(f.externalBuild),
            planningStarted:
              typeof asJson(f.planningStarted) === 'boolean'
                ? (asJson(f.planningStarted) as boolean)
                : null,
            planClosed: asJson(f.planClosedStamp),
            buildMode: asJson(f.buildMode),
            openConflicts: num(f.openConflicts),
            totalCostUsd: num(f.totalCostUsd),
            budgetUsd: f.budgetUsd == null ? null : num(f.budgetUsd),
          }
        : null;

      const prs = mergePrs(
        (session ? (builderPrsBySession.get(session.id) ?? []) : []).map(
          (pr) => ({
            repo: String(pr.repo),
            number: num(pr.prNumber),
            url: String(pr.prUrl ?? ''),
            state: pr.merged
              ? ('merged' as const)
              : pr.state === 'closed'
                ? ('closed' as const)
                : ('open' as const),
            ci: ciState(pr.ciStatus as string | null),
          }),
        ),
        (linkedByOpp.get(row.id) ?? []).map((pr) => ({
          repo: String(pr.repo),
          number: num(pr.prNumber),
          url: String(pr.prUrl ?? ''),
          state: (['open', 'merged', 'closed'].includes(String(pr.state))
            ? pr.state
            : 'open') as 'open' | 'merged' | 'closed',
          ci: 'unknown' as const,
        })),
      );
      const itemReleases: ReleaseFact[] = (releasesByOpp.get(row.id) ?? []).map(
        (r) => ({
          repo: String(r.repo),
          prNumber: num(r.prNumber),
          service: String(r.service),
          state: (['pending', 'live', 'failed'].includes(String(r.state))
            ? r.state
            : 'pending') as 'pending' | 'live' | 'failed',
          tag: (r.tag as string | null) ?? null,
          releasedAt: toIso(r.releasedAt),
        }),
      );
      const sessionDecisions = session
        ? (decisionsBySession.get(session.id) ?? [])
        : [];
      const sessionAsks: OpenAsk[] = (
        session ? (asksBySession.get(session.id) ?? []) : []
      ).map((a) => ({
        questionId: String(a.questionId),
        content: String(a.content ?? ''),
        createdAt: toIso(a.createdAt) ?? new Date(0).toISOString(),
      }));
      const detail = ctx.detail;
      const planning: PlanningFacts = {
        prdPercent: detail ? Math.round(num(detail.readiness?.score)) : null,
        openQuestions:
          sessionDecisions.filter((d) => QUESTION_KINDS.includes(d.kind))
            .length + sessionAsks.length,
        designAwaitingApproval:
          sessionDecisions.some((d) => d.kind === 'design_review') ||
          (detail ? this.designState(detail) === 'awaitingApproval' : false),
      };

      const opp = {
        stage: String(row.stage),
        reviewState: (f.reviewState as string | null) ?? null,
        reviewedBy: f.reviewedBy == null ? null : num(f.reviewedBy),
        reviewedAt: toIso(f.reviewedAt),
        createdAt: toIso(row.createdAt) ?? new Date(0).toISOString(),
        updatedAt: toIso(row.updatedAt) ?? new Date(0).toISOString(),
        releasedAt: toIso(row.releasedAt),
        planStageAt: toIso(f.oppPlanStageAt),
        votes: Math.round(num(row.priorityScore) * 10) / 10,
        declineReason: (f.declineReason as string | null) ?? null,
        starredById: f.starredByUserId == null ? null : num(f.starredByUserId),
        voterCount: num(row.voterCount),
        goalsHelped: num(row.goalsHelped),
        goalsAssessed: num(row.goalsAssessed),
        referenceImages: (asJson<{ url?: string }[]>(row.referenceImages) ?? [])
          .map((img) => img?.url)
          .filter((url): url is string => typeof url === 'string'),
        productGoal: String(row.productGoal ?? ''),
      };

      const planFacts =
        detail && session?.kind === 'plan'
          ? await this.planFactsFor(session.id, detail)
          : null;
      const stage = deriveItemStage(
        itemStageFacts({
          opportunity: opp,
          session,
          planFacts,
          planning,
          prs,
          releases: itemReleases,
        }),
      );

      const authorId = num(row.createdBy);
      const leadId = session?.leadUserId ?? null;
      const votedByMe = f.votedByMe === true || f.votedByMe === 't';
      const watchLevel = (
        Object.values(RoadmapWatchLevel).includes(
          f.watchLevel as RoadmapWatchLevel,
        )
          ? f.watchLevel
          : authorId === userId || leadId === userId
            ? RoadmapWatchLevel.ALL
            : votedByMe
              ? RoadmapWatchLevel.MILESTONES
              : RoadmapWatchLevel.NONE
      ) as RoadmapWatchLevel;
      const lastSeenAt = toIso(f.lastSeenAt);
      const lastActivityAt = latest(
        opp.updatedAt,
        session?.updatedAt,
        f.lastCommentAt,
      );
      const itemNotices: Notice[] = (noticesByItem.get(row.id) ?? []).map(
        (n) => ({
          kind: String(n.kind),
          createdAt: toIso(n.createdAt) ?? new Date(0).toISOString(),
          byUserId: n.byUserId == null ? null : num(n.byUserId) || null,
        }),
      );
      // Unread: something happened since you last opened it, or a notice
      // about it reached you after that. An idea you never opened is not
      // bold just for existing (the board has hundreds).
      const unread =
        (lastSeenAt !== null && lastActivityAt > lastSeenAt) ||
        itemNotices.some(
          (n) => lastSeenAt === null || n.createdAt > lastSeenAt,
        );

      const services = [...new Set(itemReleases.map((r) => r.service))];
      cores.push({
        id: row.id,
        code: String(row.code),
        title: titleOf(row.description),
        description: String(row.description ?? ''),
        authorName: authorNames.get(authorId) ?? '',
        shownStage: stage.shownStage,
        reviewState: (opp.reviewState ?? 'accepted') as
          | 'pending'
          | 'accepted'
          | 'declined',
        goalId: (f.goalId as string | null) ?? null,
        goalName: (f.goalName as string | null) ?? null,
        authorId,
        leadId,
        services,
        starred: !!row.directorStarred,
        openQuestion: planning.openQuestions > 0,
        votedByMe,
        plannedMonth: row.plannedMonth ?? null,
        votes: opp.votes,
        queueRank: row.queueRank == null ? null : num(row.queueRank),
        compositeScore: num(row.compositeScore),
        createdAt: opp.createdAt,
        lastActivityAt,
        stageSince: stageSinceOf(stage, opp, session),
        opp,
        session,
        stage,
        prs,
        releases: itemReleases,
        decisions: sessionDecisions,
        asks: sessionAsks,
        notices: itemNotices,
        watchLevel,
        unread,
      });
    }
    return cores;
  }

  private async planFactsFor(sessionId: string, detail: PlanSessionDetail) {
    try {
      const plan = await this.planStore.find(sessionId);
      return plan ? await this.planStage.facts(plan, detail) : null;
    } catch (error) {
      this.logger.warn(
        `Could not read plan facts for ${sessionId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  /** The session's PRD and design, read as its creator (it is shared once filed). */
  private async sessionDetail(
    sessionId: string,
  ): Promise<PlanSessionDetail | null> {
    try {
      const rows: { createdBy: number }[] = await this.dataSource.query(
        `SELECT "createdBy" FROM "builder_sessions" WHERE id = $1 AND "deletedAt" IS NULL`,
        [sessionId],
      );
      if (!rows[0]) return null;
      return await this.builderSessions.getSessionDetail(
        sessionId,
        Number(rows[0].createdBy),
      );
    } catch (error) {
      this.logger.warn(
        `Could not read session ${sessionId} for the idea page: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  private designState(detail: PlanSessionDetail | null): ItemDesignState {
    const design = (
      detail?.prd as { technicalDesign?: { status?: string } } | undefined
    )?.technicalDesign;
    if (!design?.status) return 'none';
    if (design.status === 'approved' && !detail?.designReadiness?.stale) {
      return 'approved';
    }
    if (design.status === 'review') return 'awaitingApproval';
    return 'draft';
  }

  private async runs(sessionId: string): Promise<ItemDetail['runs']> {
    const rows: {
      id: string;
      mode: string;
      status: string;
      costUsd: string | null;
    }[] = await this.dataSource.query(
      `SELECT id, mode, status, "costUsd" FROM "builder_build_runs"
        WHERE "sessionId" = $1 ORDER BY sequence ASC`,
      [sessionId],
    );
    return rows.map((r) => ({
      id: r.id,
      phase: r.mode,
      state: r.status,
      costUsd: num(r.costUsd),
    }));
  }

  private async spend(
    session: SessionFacts,
  ): Promise<ItemDetail['spend'] | undefined> {
    if (session.kind === 'plan') {
      const state = await this.ceiling.state(session.id).catch(() => null);
      return state
        ? {
            spentUsd: Number(state.spentUsd.toFixed(4)),
            ceilingUsd: state.ceilingUsd,
          }
        : undefined;
    }
    // A Builder session opened from a legacy idea: its own running total and budget.
    return session.budgetUsd
      ? { spentUsd: session.totalCostUsd, ceilingUsd: session.budgetUsd }
      : undefined;
  }

  private async outcome(
    sessionId: string,
  ): Promise<ItemDetail['outcome'] | undefined> {
    const rows: Record<string, unknown>[] = await this.dataSource.query(
      `SELECT "dueDate", verdict, observed, reasons, "nextSteps", "createdAt"
         FROM "plan_outcome_reviews" WHERE "sessionId" = $1
        ORDER BY "createdAt" DESC LIMIT 1`,
      [sessionId],
    );
    const r = rows[0];
    if (!r) return undefined;
    return {
      review: {
        dueDate: r.dueDate,
        verdict: r.verdict,
        observed: r.observed,
        reasons: r.reasons,
        nextSteps: Array.isArray(r.nextSteps) ? r.nextSteps : [],
        at: toIso(r.createdAt),
      },
    };
  }

  // ── Rows and people ────────────────────────────────────────────────────────

  private async toRows(loaded: Loaded, cores: ItemCore[]): Promise<ItemRow[]> {
    const ids = new Set<number>();
    for (const c of cores) {
      ids.add(c.authorId);
      if (c.leadId) ids.add(c.leadId);
      if (c.starred && c.opp.starredById) ids.add(c.opp.starredById);
      if (c.whyHere?.kind === 'mention' && c.whyHere.by.id) {
        ids.add(c.whyHere.by.id);
      }
    }
    const people = await this.resolvePeople([...ids]);
    const person = (id: number, relation?: ItemRelation): PersonRef => ({
      ...(people.get(id) ?? {
        id,
        name: '',
        role: 'none' as RoadmapRole,
        ideasShipped: 0,
      }),
      ...(relation ? { relation } : {}),
    });
    return cores.map((c) => {
      let whyHere = c.whyHere;
      if (whyHere?.kind === 'mention') {
        whyHere = { ...whyHere, by: person(whyHere.by.id) };
      }
      return {
        id: c.id,
        code: c.code,
        title: c.title,
        shownStage: c.shownStage,
        stage: simpleStageOf(c.shownStage, c.leadId),
        statusParts: c.stage.statusParts,
        author: person(c.authorId, 'author'),
        ...(c.leadId ? { lead: person(c.leadId, 'lead') } : {}),
        votes: c.votes,
        queueRank: c.queueRank,
        votedByMe: c.votedByMe,
        starred: c.starred,
        ...(c.starred && c.opp.starredById
          ? { starredBy: person(c.opp.starredById, 'owner') }
          : {}),
        unread: c.unread,
        ...(whyHere ? { whyHere } : {}),
        ...(c.goalId && c.goalName
          ? { goal: { id: c.goalId, name: c.goalName } }
          : {}),
        plannedMonth: c.plannedMonth,
        updatedAt: c.lastActivityAt,
        stageSince: c.stageSince,
      };
    });
  }

  /** Everyone the idea page names, with their role: never "user 4" (§4.5c). */
  private async people(c: ItemCore): Promise<PersonRef[]> {
    const entries: [number, ItemRelation | undefined][] = [
      [c.authorId, 'author'],
    ];
    if (c.leadId) entries.push([c.leadId, 'lead']);
    if (c.opp.reviewedBy) entries.push([c.opp.reviewedBy, 'owner']);
    if (c.starred && c.opp.starredById) {
      entries.push([c.opp.starredById, 'owner']);
    }
    const parts = c.stage.statusParts;
    // "Brief sent to Claude Code by …" (planning) and "Building in Claude Code" both name the sender.
    if (
      (parts.stage === 'building' || parts.stage === 'planning') &&
      parts.externalBuild
    ) {
      entries.push([parts.externalBuild.byUserId, 'builder']);
    }
    if (parts.stage === 'closed' && parts.byUserId) {
      entries.push([parts.byUserId, undefined]);
    }
    const people = await this.resolvePeople(entries.map(([id]) => id));
    const out: PersonRef[] = [];
    const seen = new Set<number>();
    for (const [id, relation] of entries) {
      if (seen.has(id)) continue;
      seen.add(id);
      const p = people.get(id);
      if (p) out.push({ ...p, ...(relation ? { relation } : {}) });
    }
    return out;
  }

  private async resolvePeople(ids: number[]): Promise<Map<number, PersonRef>> {
    const unique = [...new Set(ids.filter((id) => id > 0))];
    if (!unique.length) return new Map();
    const [rows, shipped, roles] = await Promise.all([
      this.dataSource.query(
        `SELECT id, name FROM "users" WHERE id = ANY($1::int[])`,
        [unique],
      ) as Promise<{ id: number; name: string | null }[]>,
      this.ideasShipped(unique),
      Promise.all(
        unique.map((id) =>
          this.roles.roleOf(id).catch(() => 'none' as RoadmapRole),
        ),
      ),
    ]);
    const names = new Map(rows.map((r) => [Number(r.id), r.name ?? '']));
    return new Map(
      unique.map((id, i) => [
        id,
        {
          id,
          // A removed account keeps its history: a placeholder, never a bare id.
          name: names.get(id)?.trim() || 'Former member',
          role: roles[i],
          ideasShipped: shipped.get(id) ?? 0,
        },
      ]),
    );
  }

  /**
   * Ideas each person filed that are Released: the chip's "ideas shipped"
   * (§4.14). Bugs are not ideas. A failed count reads as none rather than
   * failing the page.
   */
  private async ideasShipped(ids: number[]): Promise<Map<number, number>> {
    try {
      const rows: { userId: number; shipped: string | number }[] =
        await this.dataSource.query(
          `SELECT "createdBy" AS "userId", count(*) AS shipped
             FROM "roadmap_opportunities"
            WHERE "createdBy" = ANY($1::int[])
              AND stage = 'released'
              AND type <> 'bug'
              AND "deletedAt" IS NULL
            GROUP BY "createdBy"`,
          [ids],
        );
      return new Map(
        (rows ?? []).map((r) => [Number(r.userId), Number(r.shipped)]),
      );
    } catch (error) {
      this.logger.warn(
        `Could not count ideas shipped: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return new Map();
    }
  }

  private noAccess(): ForbiddenException {
    return new ForbiddenException('You do not have access to the Roadmap.');
  }
}
