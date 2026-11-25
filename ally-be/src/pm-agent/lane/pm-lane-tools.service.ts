import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { DataSource, In, MoreThan } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { AgentToolDefinition } from 'src/llm-agent/type/agent-llm.type';
import { computeServiceCostUsd } from 'src/analytics/constants/llm-pricing.constants';
import { AI_TASK_REGISTRY } from 'src/llm/constants/ai-task-registry.constants';
import { ActivationAnalyticsService } from 'src/analytics/service/activation-analytics.service';
import { CoachingLoopAnalyticsService } from 'src/analytics/service/coaching-loop-analytics.service';
import { CompetencyMapAnalyticsService } from 'src/analytics/service/competency-map-analytics.service';
import { CompletionRateAnalyticsService } from 'src/analytics/service/completion-rate-analytics.service';
import { HighlightsAnalyticsService } from 'src/analytics/service/highlights-analytics.service';
import { LanguageMixAnalyticsService } from 'src/analytics/service/language-mix-analytics.service';
import { OrgHealthAnalyticsService } from 'src/analytics/service/org-health-analytics.service';
import { PlatformAnalyticsService } from 'src/analytics/service/platform-analytics.service';
import { QualityDistributionAnalyticsService } from 'src/analytics/service/quality-distribution-analytics.service';
import { RoleplayVolumeAnalyticsService } from 'src/analytics/service/roleplay-volume-analytics.service';
import { ScribeAdoptionAnalyticsService } from 'src/analytics/service/scribe-adoption-analytics.service';
import { ScribeAnalyticsService } from 'src/analytics/service/scribe-analytics.service';
import { SkillGrowthAnalyticsService } from 'src/analytics/service/skill-growth-analytics.service';
import { TrackDropoffAnalyticsService } from 'src/analytics/service/track-dropoff-analytics.service';
import { UsageLevelAnalyticsService } from 'src/analytics/service/usage-level-analytics.service';
import { RoadmapProductGoalRepository } from 'src/product-roadmap/repository/roadmap-taxonomy.repository';
import {
  DEAD_CODE_SIGNAL_FRESH_DAYS,
  DEAD_CODE_SIGNAL_SOURCE,
  PM_PLATFORM_USER_ID,
} from '../constants/pm-agent.constants';
import { PmAgentSignal } from '../entity/pm-agent-signal.entity';
import { PM_PIPELINE } from '../constants/pm-agent-pipeline.constants';
import { PmSignalStatus } from '../enum/pm-agent.enum';
import { PmAgentSignalRepository } from '../repository/pm-agent.repositories';
import {
  PmEvidenceDraft,
  PmEvidenceRef,
  PmToolbox,
  PmToolContext,
  PmToolOutcome,
} from '../pipeline/pm-pipeline.types';
import { compact, fence } from '../util/fence.util';
import { relevance } from '../util/text-similarity.util';
import { PM_DELEGATED_TOOLS, PmTool } from './pm-lane-definitions';

/** The analytics sections a lane may read: the reviewed dashboard aggregates, nothing raw. */
const ANALYTICS_SECTIONS = [
  'platformOverview',
  'leadershipHighlights',
  'learnerActivation',
  'roleplayCompletionRate',
  'languageMix',
  'scoreDistribution',
  'coachingLoop',
  'scribeAdoption',
  'scribeOverview',
  'orgHealth',
  'usageLevels',
  'roleplayVolumePerLearner',
  'skillGrowth',
  'competencyMap',
  'trackDropoff',
] as const;
type AnalyticsSection = (typeof ANALYTICS_SECTIONS)[number];
const ALL_TIME: ReadonlySet<string> = new Set([
  'orgHealth',
  'usageLevels',
  'roleplayVolumePerLearner',
  'skillGrowth',
  'competencyMap',
  'trackDropoff',
]);
const RANGES = ['30d', '90d', '12m'] as const;

const DELEGATED_SOURCE: Record<string, { source: string; kind: string }> = {
  [PmTool.SEARCH_ROADMAP]: { source: 'roadmap', kind: 'search' },
  [PmTool.GET_OPPORTUNITY]: { source: 'roadmap', kind: 'opportunity' },
  [PmTool.SEARCH_USER_INTERVIEWS]: { source: 'interviews', kind: 'search' },
  [PmTool.BUG_FINDINGS_SEARCH]: { source: 'bug_hunter', kind: 'finding' },
  [PmTool.DOCS_SEARCH]: { source: 'docs', kind: 'search' },
  [PmTool.GITHUB_SEARCH_CODE]: { source: 'code', kind: 'search' },
  [PmTool.GITHUB_READ_FILE]: { source: 'code', kind: 'file' },
  [PmTool.GITHUB_REPO_TREE]: { source: 'code', kind: 'tree' },
  [PmTool.WIKI_SEARCH]: { source: 'wiki', kind: 'search' },
  [PmTool.WIKI_READ]: { source: 'wiki', kind: 'file' },
};

const OWN_TOOLS: Record<string, AgentToolDefinition> = {
  [PmTool.ANALYTICS_SECTION]: {
    name: PmTool.ANALYTICS_SECTION,
    description:
      'Read one platform analytics section — the same reviewed aggregate the Analytics tab ' +
      'shows (platform-wide, compacted: long lists are cut and say so). Six sections are ' +
      'all-time by construction and say `allTime: true`; never describe those as a change in ' +
      'the window. Returns an evidenceId you can cite.',
    input_schema: {
      type: 'object',
      properties: {
        section: { type: 'string', enum: [...ANALYTICS_SECTIONS] },
        range: { type: 'string', enum: [...RANGES] },
      },
      required: ['section'],
    },
  },
  [PmTool.UX_SIGNALS_LIST]: {
    name: PmTool.UX_SIGNALS_LIST,
    description:
      'UX Signals findings (rage/dead clicks, abandoned routes, zero-result searches, funnel ' +
      'drop-off), aggregated, and security audit findings (source `security_audit`, with ' +
      'severity, file and fix in `metrics`), with first/last seen dates. Each finding is its ' +
      'own evidence item. Check the dates before stating anything in the present tense.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Optional words over titles and summaries',
        },
      },
    },
  },
  [PmTool.DEAD_CODE_LIST]: {
    name: PmTool.DEAD_CODE_LIST,
    description:
      'Modules with unused code, from the weekly dead-code report: module path, repo, item count, ' +
      'counts by kind and up to 40 items. Each module is its own evidence item. Static analysis ' +
      'finds candidates, not proof: dynamic dispatch can hide real use, so read the code before ' +
      'proposing deletion. Propose one module per card.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Optional words over module paths (a repo or folder name)',
        },
      },
    },
  },
  [PmTool.LLM_USAGE_SUMMARY]: {
    name: PmTool.LLM_USAGE_SUMMARY,
    description:
      'Model spend by AI task and model over the last N days (llm_usage, priced with the ' +
      'shared pricing table): top rows by cost plus totals.',
    input_schema: {
      type: 'object',
      properties: { days: { type: 'integer', enum: [7, 30] } },
    },
  },
  [PmTool.AI_TASK_REGISTRY]: {
    name: PmTool.AI_TASK_REGISTRY,
    description:
      'The AI task registry: every call to a model on the platform, what triggers it and its ' +
      'default model and tier. Optional words narrow it.',
    input_schema: {
      type: 'object',
      properties: { query: { type: 'string' } },
    },
  },
  [PmTool.PRODUCT_GOALS]: {
    name: PmTool.PRODUCT_GOALS,
    description: "The roadmap's product goals (filing categories), in order.",
    input_schema: { type: 'object', properties: {} },
  },
};

interface DelegatedTools {
  getToolDefinitions(): AgentToolDefinition[];
  describe(name: string, input: Record<string, any>): string;
  execute(
    name: string,
    input: Record<string, any>,
    ctx: { userId: number },
  ): Promise<{ modelResult: string; summary: string; ok: boolean }>;
}

/**
 * The lanes' tool belt. READ-ONLY: the only rows any tool writes are its own evidence items
 * (pm_agent_evidence), recorded as it fetches, so a card can cite exactly what was looked at.
 *
 * Sources: the AnalyticsModule's exported aggregate services; pm_agent_signals (written by UX
 * Signals; the lane never imports UX Signals itself); llm_usage aggregates and the AI task
 * registry; the roadmap copilot's read tools (roadmap, interviews, Bug Hunter findings, docs,
 * GitHub code and wiki through Builder's GitHub read service), reached lazily through ModuleRef
 * as the Builder port does. Every result the model reads is fenced as untrusted data.
 *
 * Not here on purpose: the copilot's `analytics_ask` (a second, separately-billed agent) and
 * principles search (Context Library, attributed to the copilot's use case); the AWS logs
 * proxy (LogsService is not exported for this use).
 */
@Injectable()
export class PmLaneToolsService implements PmToolbox {
  private readonly logger = LoggerService.getInstance(PmLaneToolsService.name);
  private delegatedCache: DelegatedTools | null = null;

  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly dataSource: DataSource,
    private readonly signals: PmAgentSignalRepository,
    private readonly productGoals: RoadmapProductGoalRepository,
    private readonly platformAnalytics: PlatformAnalyticsService,
    private readonly highlights: HighlightsAnalyticsService,
    private readonly activation: ActivationAnalyticsService,
    private readonly completionRate: CompletionRateAnalyticsService,
    private readonly languageMix: LanguageMixAnalyticsService,
    private readonly qualityDistribution: QualityDistributionAnalyticsService,
    private readonly coachingLoop: CoachingLoopAnalyticsService,
    private readonly scribeAdoption: ScribeAdoptionAnalyticsService,
    private readonly scribe: ScribeAnalyticsService,
    private readonly orgHealth: OrgHealthAnalyticsService,
    private readonly usageLevels: UsageLevelAnalyticsService,
    private readonly roleplayVolume: RoleplayVolumeAnalyticsService,
    private readonly skillGrowth: SkillGrowthAnalyticsService,
    private readonly competencyMap: CompetencyMapAnalyticsService,
    private readonly trackDropoff: TrackDropoffAnalyticsService,
  ) {}

  private async delegated(): Promise<DelegatedTools> {
    if (this.delegatedCache) return this.delegatedCache;
    const { RoadmapCopilotToolsService } =
      await import('../../product-roadmap/service/roadmap-copilot-tools.service');
    this.delegatedCache = this.moduleRef.get(RoadmapCopilotToolsService, {
      strict: false,
    }) as unknown as DelegatedTools;
    return this.delegatedCache;
  }

  async definitions(names: readonly string[]): Promise<AgentToolDefinition[]> {
    const wanted = new Set(names);
    const out: AgentToolDefinition[] = [];
    let delegated: AgentToolDefinition[] = [];
    if (names.some((name) => PM_DELEGATED_TOOLS.has(name))) {
      try {
        delegated = (await this.delegated()).getToolDefinitions();
      } catch (error) {
        this.logger.warn(
          `[PM_AGENT] Roadmap/code tools unavailable: ${(error as Error)?.message}`,
        );
      }
    }
    // Stable order (the allow-list's), so the cached prefix is not invalidated by reordering.
    for (const name of names) {
      if (!wanted.has(name)) continue;
      const own = OWN_TOOLS[name];
      if (own) out.push(own);
      else {
        const found = delegated.find((tool) => tool.name === name);
        if (found) out.push(found);
      }
    }
    return out;
  }

  async execute(
    name: string,
    input: Record<string, any>,
    ctx: PmToolContext,
  ): Promise<PmToolOutcome> {
    try {
      switch (name) {
        case PmTool.ANALYTICS_SECTION:
          return await this.analyticsSection(input, ctx);
        case PmTool.UX_SIGNALS_LIST:
          return await this.uxSignals(input, ctx);
        case PmTool.DEAD_CODE_LIST:
          return await this.deadCode(input, ctx);
        case PmTool.LLM_USAGE_SUMMARY:
          return await this.llmUsageSummary(input, ctx);
        case PmTool.AI_TASK_REGISTRY:
          return await this.registry(input, ctx);
        case PmTool.PRODUCT_GOALS:
          return await this.goals(ctx);
        default:
          if (PM_DELEGATED_TOOLS.has(name)) {
            return await this.runDelegated(name, input, ctx);
          }
          return this.fail(name, `Unknown tool "${name}"`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[PM_AGENT] Tool ${name} failed: ${message}`);
      return this.fail(name, message);
    }
  }

  // ── evidence ─────────────────────────────────────────────────────────────

  /** Persist one evidence item and return the reference the run tracks. */
  async record(runId: string, draft: PmEvidenceDraft): Promise<PmEvidenceRef> {
    const serialised = JSON.stringify(draft.snapshot ?? null) ?? 'null';
    const snapshot =
      serialised.length > PM_PIPELINE.EVIDENCE_SNAPSHOT_MAX_CHARS
        ? {
            truncated: true,
            text: serialised.slice(0, PM_PIPELINE.EVIDENCE_SNAPSHOT_MAX_CHARS),
          }
        : draft.snapshot;
    const fetchedAt = new Date();
    const rows: { id: string }[] = await this.dataSource.query(
      `INSERT INTO "pm_agent_evidence" ("runId", "source", "kind", "label", "query", "snapshot", "url", "fetchedAt")
       VALUES ($1::uuid, $2::varchar, $3::varchar, $4::varchar, $5::jsonb, $6::jsonb, $7::text, $8::timestamptz)
       RETURNING id`,
      [
        runId,
        draft.source.slice(0, 32),
        draft.kind.slice(0, 32),
        draft.label.slice(0, 200),
        JSON.stringify(draft.query ?? null),
        JSON.stringify(snapshot ?? null),
        draft.url ?? null,
        fetchedAt,
      ],
    );
    return {
      id: rows[0].id,
      source: draft.source,
      kind: draft.kind,
      label: draft.label.slice(0, 200),
      fetchedAt,
      excerpt: serialised.slice(0, PM_PIPELINE.CRITIC_EVIDENCE_MAX_CHARS),
    };
  }

  private wrap(ref: PmEvidenceRef, body: unknown): PmToolOutcome {
    return {
      ok: true,
      evidence: [ref],
      modelResult: fence(
        'tool_data',
        { evidence_id: ref.id, source: ref.source, label: ref.label },
        JSON.stringify(body),
        PM_PIPELINE.TOOL_RESULT_MAX_CHARS,
      ),
    };
  }

  private fail(name: string, message: string): PmToolOutcome {
    return {
      ok: false,
      evidence: [],
      modelResult: JSON.stringify({
        ok: false,
        tool: name,
        error: message.slice(0, 300),
        note: 'The lookup failed; do not conclude the source is empty.',
      }),
    };
  }

  // ── tools ────────────────────────────────────────────────────────────────

  private async analyticsSection(
    input: Record<string, any>,
    ctx: PmToolContext,
  ): Promise<PmToolOutcome> {
    const section = String(input.section ?? '') as AnalyticsSection;
    if (!ANALYTICS_SECTIONS.includes(section)) {
      return this.fail(
        PmTool.ANALYTICS_SECTION,
        `Unknown section "${section}"`,
      );
    }
    const range = RANGES.includes(input.range) ? input.range : '30d';
    const q = { range } as never;
    const runners: Record<AnalyticsSection, () => Promise<unknown>> = {
      platformOverview: () => this.platformAnalytics.getOverview(q),
      leadershipHighlights: () => this.highlights.getHighlights(q),
      learnerActivation: () => this.activation.getActivation(q),
      roleplayCompletionRate: () => this.completionRate.getCompletionRate(q),
      languageMix: () => this.languageMix.getLanguageMix(q),
      scoreDistribution: () =>
        this.qualityDistribution.getQualityDistribution(q),
      coachingLoop: () => this.coachingLoop.getCoachingLoop(q),
      scribeAdoption: () => this.scribeAdoption.getScribeAdoption(q),
      scribeOverview: () => this.scribe.getOverview(q),
      orgHealth: () => this.orgHealth.getOrgHealth({} as never),
      usageLevels: () => this.usageLevels.getUsageLevels({} as never),
      roleplayVolumePerLearner: () =>
        this.roleplayVolume.getRoleplayVolume({} as never),
      skillGrowth: () => this.skillGrowth.getSkillGrowth({} as never),
      competencyMap: () => this.competencyMap.getCompetencyMap({} as never),
      trackDropoff: () => this.trackDropoff.getTrackDropoff({} as never),
    };
    const allTime = ALL_TIME.has(section);
    const data = compact(await runners[section]());
    const body = allTime ? { allTime: true, data } : { range, data };
    const ref = await this.record(ctx.runId, {
      source: 'analytics',
      kind: 'chart',
      label: `Analytics: ${section}${allTime ? ' (all time)' : ` (${range})`}`,
      query: { section, range: allTime ? 'all' : range },
      snapshot: body,
    });
    return this.wrap(ref, body);
  }

  private async uxSignals(
    input: Record<string, any>,
    ctx: PmToolContext,
  ): Promise<PmToolOutcome> {
    const since = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
    const rows = await this.signals.find({
      where: {
        // This table also holds dead-code evidence, which has its own tool: leave it out,
        // or the lane would cite a code report as telemetry. UX and security-audit rows stay.
        source: In(['ux_signals', 'security_audit']),
        status: In([PmSignalStatus.NEW, PmSignalStatus.USED]),
        lastSeenAt: MoreThan(since),
      },
      order: { lastSeenAt: 'DESC' },
      take: 60,
    });
    const query = String(input.query ?? '').trim();
    const picked = (
      query
        ? rows
            .map((row) => ({
              row,
              score: relevance(query, `${row.title} ${row.summary} ${row.key}`),
            }))
            .filter((item) => item.score > 0)
            .sort((a, b) => b.score - a.score)
            .map((item) => item.row)
        : rows
    ).slice(0, 15);
    if (!picked.length) {
      return {
        ok: true,
        evidence: [],
        modelResult: JSON.stringify({
          ok: true,
          signals: [],
          note: rows.length
            ? 'No UX signal matched those words.'
            : 'No UX signals are recorded for the last 45 days: there is no telemetry evidence to cite.',
        }),
      };
    }
    const refs: PmEvidenceRef[] = [];
    const parts: string[] = [];
    for (const row of picked) {
      const snapshot = {
        title: row.title,
        summary: row.summary,
        detector: row.detector,
        severity: row.severity ?? null,
        metrics: compact(row.metrics ?? null),
        firstSeenAt: row.firstSeenAt,
        lastSeenAt: row.lastSeenAt,
      };
      const ref = await this.record(ctx.runId, {
        source: row.source,
        kind: 'finding',
        label:
          row.source === 'security_audit'
            ? `Security audit: ${row.title}`
            : `UX signal: ${row.title}`,
        query: { signalId: row.id, detector: row.detector, key: row.key },
        snapshot,
      });
      refs.push(ref);
      parts.push(
        fence(
          'tool_data',
          { evidence_id: ref.id, source: ref.source, label: ref.label },
          JSON.stringify(snapshot),
          1500,
        ),
      );
    }
    return { ok: true, evidence: refs, modelResult: parts.join('\n') };
  }

  private async deadCode(
    input: Record<string, any>,
    ctx: PmToolContext,
  ): Promise<PmToolOutcome> {
    const since = new Date(
      Date.now() - DEAD_CODE_SIGNAL_FRESH_DAYS * 24 * 60 * 60 * 1000,
    );
    // NEW only: a module the agent already turned into a card (USED) or an admin dismissed
    // is decided, and must not come back as fresh evidence.
    const rows = await this.signals.find({
      where: {
        source: DEAD_CODE_SIGNAL_SOURCE,
        status: PmSignalStatus.NEW,
        lastSeenAt: MoreThan(since),
      },
      order: { lastSeenAt: 'DESC' },
      take: 400,
    });
    const query = String(input.query ?? '').trim();
    const count = (row: PmAgentSignal) => Number(row.metrics?.count ?? 0);
    const picked = (
      query ? rows.filter((row) => relevance(query, row.key) > 0) : rows
    )
      .sort((a, b) => count(b) - count(a))
      .slice(0, 15);
    if (!picked.length) {
      return {
        ok: true,
        evidence: [],
        modelResult: JSON.stringify({
          ok: true,
          modules: [],
          note: rows.length
            ? 'No module matched those words.'
            : 'No dead-code report is recorded for the last 10 days: there is nothing to cite.',
        }),
      };
    }
    const refs: PmEvidenceRef[] = [];
    const parts: string[] = [];
    for (const row of picked) {
      const snapshot = {
        module: row.key,
        repo: row.metrics?.repo ?? null,
        count: count(row),
        kinds: row.metrics?.kinds ?? {},
        items: row.metrics?.items ?? [],
        lastSeenAt: row.lastSeenAt,
      };
      const ref = await this.record(ctx.runId, {
        source: DEAD_CODE_SIGNAL_SOURCE,
        kind: 'finding',
        label: `Dead code: ${row.key}`,
        query: { signalId: row.id, detector: row.detector, key: row.key },
        snapshot,
      });
      refs.push(ref);
      parts.push(
        fence(
          'tool_data',
          { evidence_id: ref.id, source: ref.source, label: ref.label },
          JSON.stringify(snapshot),
          2500,
        ),
      );
    }
    return { ok: true, evidence: refs, modelResult: parts.join('\n') };
  }

  private async llmUsageSummary(
    input: Record<string, any>,
    ctx: PmToolContext,
  ): Promise<PmToolOutcome> {
    const days = Number(input.days) === 7 ? 7 : 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const rows: Record<string, string>[] = await this.dataSource.query(
      `SELECT service, provider, model, task, COUNT(*) AS calls,
              COALESCE(SUM("promptTokens"), 0) AS prompt,
              COALESCE(SUM("completionTokens"), 0) AS completion,
              COALESCE(SUM("totalTokens"), 0) AS total,
              COALESCE(SUM("cachedTokens"), 0) AS cached,
              COALESCE(SUM("audioMs"), 0) AS audio,
              COALESCE(SUM(characters), 0) AS chars
         FROM llm_usage WHERE "occurredAt" >= $1::timestamp
        GROUP BY service, provider, model, task`,
      [since],
    );
    const priced = rows
      .map((row) => {
        const { costUsd, priced: isPriced } = computeServiceCostUsd(
          (row.service || 'llm') as never,
          row.provider,
          row.model,
          {
            promptTokens: Number(row.prompt),
            completionTokens: Number(row.completion),
            totalTokens: Number(row.total),
            cachedTokens: Number(row.cached),
            audioMs: Number(row.audio),
            characters: Number(row.chars),
          },
          row.task,
        );
        return {
          task: row.task,
          service: row.service,
          provider: row.provider,
          model: row.model,
          calls: Number(row.calls),
          promptTokens: Number(row.prompt),
          completionTokens: Number(row.completion),
          cachedTokens: Number(row.cached),
          costUsd: Number(costUsd.toFixed(2)),
          priced: isPriced,
        };
      })
      .sort((a, b) => b.costUsd - a.costUsd);
    const body = {
      days,
      totalCostUsd: Number(
        priced.reduce((sum, row) => sum + row.costUsd, 0).toFixed(2),
      ),
      totalCalls: priced.reduce((sum, row) => sum + row.calls, 0),
      unpricedRows: priced.filter((row) => !row.priced).length,
      top: priced.slice(0, 15),
    };
    const ref = await this.record(ctx.runId, {
      source: 'llm_usage',
      kind: 'metric',
      label: `Model spend by task, last ${days} days`,
      query: { days },
      snapshot: body,
    });
    return this.wrap(ref, body);
  }

  private async registry(
    input: Record<string, any>,
    ctx: PmToolContext,
  ): Promise<PmToolOutcome> {
    const query = String(input.query ?? '').trim();
    const rows = AI_TASK_REGISTRY.map((row) => ({
      id: row.id,
      task: row.task,
      runtime: row.runtime,
      trigger: row.trigger,
      kind: row.kind,
      provider: row.provider,
      defaultModel: row.defaultModel,
      tier: (row as { tier?: string }).tier ?? null,
      hotPath: Boolean((row as { hotPath?: boolean }).hotPath),
    }));
    const picked = (
      query
        ? rows
            .map((row) => ({
              row,
              score: relevance(query, `${row.id} ${row.trigger} ${row.task}`),
            }))
            .filter((item) => item.score > 0)
            .sort((a, b) => b.score - a.score)
            .map((item) => item.row)
        : rows
    ).slice(0, 25);
    const body = { total: rows.length, rows: picked };
    const ref = await this.record(ctx.runId, {
      source: 'registry',
      kind: 'list',
      label: query ? `AI task registry: ${query}` : 'AI task registry',
      query: { query },
      snapshot: body,
    });
    return this.wrap(ref, body);
  }

  private async goals(ctx: PmToolContext): Promise<PmToolOutcome> {
    const goals = await this.productGoals.findAllOrdered();
    const body = { goals: goals.map((goal) => goal.name) };
    const ref = await this.record(ctx.runId, {
      source: 'roadmap',
      kind: 'list',
      label: 'Roadmap product goals',
      snapshot: body,
    });
    return this.wrap(ref, body);
  }

  private async runDelegated(
    name: string,
    input: Record<string, any>,
    ctx: PmToolContext,
  ): Promise<PmToolOutcome> {
    const tools = await this.delegated();
    const out = await tools.execute(name, input, {
      userId: PM_PLATFORM_USER_ID,
    });
    if (!out.ok) {
      return {
        ok: false,
        evidence: [],
        modelResult: fence(
          'tool_data',
          { source: DELEGATED_SOURCE[name]?.source ?? 'tool' },
          out.modelResult,
          2000,
        ),
      };
    }
    let snapshot: unknown = out.modelResult;
    try {
      snapshot = JSON.parse(out.modelResult);
    } catch {
      // A truncated result stays text.
    }
    const meta = DELEGATED_SOURCE[name] ?? { source: 'tool', kind: 'lookup' };
    const ref = await this.record(ctx.runId, {
      source: meta.source,
      kind: meta.kind,
      label: tools.describe(name, input).slice(0, 200),
      query: { tool: name, input },
      snapshot,
    });
    return this.wrap(ref, snapshot);
  }
}
