import { HttpException, Injectable, Optional } from '@nestjs/common';
import { createHash } from 'crypto';
import { DataSource } from 'typeorm';
import {
  DEBRIEF_AGENT_KEY,
  DEBRIEF_ORCHESTRATOR_PROMPT_CODES,
  DEBRIEF_PROMPT_CODES,
} from '../constants/debrief-release.constants';
import { pmAgentAutonomy } from '../constants/debrief-owner-settings.constants';
import { ROLEPLAY_FIELDS_KEY } from '../constants/debrief-roleplay-fields.constants';
import { DebriefAutonomyService } from './debrief-autonomy.service';
import { DebriefNotifier } from './debrief-notifier.service';
import { parseMetricsFilter } from '../util/debrief-metrics-filter.util';
import {
  metricFailurePoints,
  metricValues,
  MetricsViewLike,
  PM_AGENT_METRICS,
} from '../util/debrief-metric-failures.util';
import {
  handoffNeverListRefusal,
  promptEditRefusal,
  Refusal,
  registryAgentRefusal,
  RegistryAgentManifest,
  changeEvidenceRefusal,
  copiesSessionText,
  guidanceEvidenceRefusal,
  instructionPatternIn,
  introducedInjectionPattern,
  introducesSessionText,
  ROUTE_KIND,
  settingRefusal,
  settingValueText,
  stripQuotes,
} from '../util/debrief-pm-agent-rules.util';
import {
  DebriefAgentClaims,
  PmAgentGatewayTool,
} from './debrief-run-token.service';
import { DebriefContextRepository } from './debrief-context.repository';
import { DebriefGuidanceMetricsService } from './debrief-guidance-metrics.service';
import { DebriefMetricsService } from './debrief-metrics.service';
import { DebriefPmAgentService } from './debrief-pm-agent.service';
import { DebriefReportingService } from './debrief-reporting.service';
import { DebriefReviewService } from './debrief-review.service';
import { DebriefRunnerService } from './debrief-runner.service';
import { DebriefSettingsService } from './debrief-settings.service';

/** Ideas one run may propose (the old analysis's cap). */
export const MAX_IDEAS_PER_RUN = 5;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Route = 'A' | 'B' | 'C' | 'D';

/** A refusal the agent reads as a tool error; never an HTTP error. */
class Refused extends Error {
  constructor(readonly refusal: Refusal) {
    super(refusal.reason);
  }
}
const refuse = (reason: string): never => {
  throw new Refused({ reason });
};
const text = (v: unknown, max = 2000): string =>
  typeof v === 'string' ? v.trim().slice(0, max) : '';
/**
 * V2_AUTONOMY A2: the confidence the PM agent states on a change, as stored in
 * `evidence.confidence`. One the agent left out reads as low: it never skips
 * the always-ask list by omission.
 */
export function changeConfidence(v: unknown): {
  level: 'high' | 'low';
  why: string;
} {
  const c = (v ?? {}) as { level?: unknown; why?: unknown };
  const why = text(c.why, 300);
  if (c.level === 'high' || c.level === 'low') {
    return { level: c.level, why: why || 'No reason given.' };
  }
  return {
    level: 'low',
    why: 'The Debrief PM agent did not say how sure it is.',
  };
}

/** A change's confidence until its reviewer has answered: it waits for a person. */
export const NOT_REVIEWED = {
  level: 'low' as const,
  why: 'Not reviewed yet: the reviewer has not checked it.',
};

type ReviewAnswer = { answer: 'yes' | 'no' | 'unclear'; evidence: string };
const REVIEW_QUESTIONS = {
  supported: ['the evidence supports it', 'the evidence may not support it'],
  fits_everywhere: [
    'it fits every language and organisation it reaches',
    'it may not fit every language or organisation it reaches',
  ],
  safe: ['no safety risk found', 'it may touch safety'],
} as const;

/**
 * The reviewer's verdict on a change (the reviewer subagent, posted by ally-ai's
 * code): high only when all three answers are yes; low otherwise. This, not
 * the PM agent's own view, is the change's `evidence.confidence`.
 */
export function reviewConfidence(b: Record<string, any>): {
  confidence: { level: 'high' | 'low'; why: string };
  answers: Record<keyof typeof REVIEW_QUESTIONS, ReviewAnswer>;
} {
  const answers = {} as Record<keyof typeof REVIEW_QUESTIONS, ReviewAnswer>;
  for (const k of Object.keys(REVIEW_QUESTIONS) as Array<
    keyof typeof REVIEW_QUESTIONS
  >) {
    const a = (b?.[k] ?? {}) as { answer?: unknown; evidence?: unknown };
    answers[k] = {
      answer: a.answer === 'yes' || a.answer === 'no' ? a.answer : 'unclear',
      evidence: text(a.evidence, 300),
    };
  }
  const weak = (
    Object.keys(REVIEW_QUESTIONS) as Array<keyof typeof REVIEW_QUESTIONS>
  ).filter((k) => answers[k].answer !== 'yes');
  const why = weak.length
    ? `Reviewer: ${weak.map((k) => `${REVIEW_QUESTIONS[k][1]}${answers[k].evidence ? ` (${answers[k].evidence})` : ''}`).join('; ')}`
    : `Reviewer: ${(Object.keys(REVIEW_QUESTIONS) as Array<keyof typeof REVIEW_QUESTIONS>).map((k) => REVIEW_QUESTIONS[k][0]).join('; ')}.`;
  return {
    confidence: { level: weak.length ? 'low' : 'high', why: why.slice(0, 300) },
    answers,
  };
}

/** Runs counted as one change's evidence (R2-18): enough for 10 learners in 3 organisations. */
const MAX_EVIDENCE_RUNS = 100;

/** A cited run, counted by learner and organisation (plan §11.6). */
interface EvidenceRun {
  id: string;
  session_id: string;
  learner: number | null;
  tenant_id: string | null;
}

/**
 * The PM agent's gateway tools (CONTRACT.md §2a; spec C1, C3, C4, C5, FR-53,
 * FR-55, FR-58): the only way the agent acts, so every rule lives here.
 *
 * - reads: `comments_read`, `reporting_query` (the existing guard), `metrics_view`
 *   (C2 failure points);
 * - `idea_propose` writes an `agent_lessons` idea with its evidence, links the
 *   comments it cites (`DebriefReviewService.linkIdea`) and snapshots the named
 *   metric for C5;
 * - `release_draft` (route A) checks the never-list, the setting ranges and
 *   FR-53, and that the change applies to GA, then stores it as the idea's change;
 *   a prompt edit or registry agent also passes the content-safety checks
 *   (R2-18, FR-56): 10 learners in 3 organisations, no instructions to a
 *   model, no copied session words;
 * - `ladder_start_quick_test` only requests ally-be's deterministic ladder;
 * - `builder_handoff`, `bug_hunter_report`, `person_ask` store what a person
 *   approves in the Console; Builder and Bug Hunter texts have quotes stripped.
 *
 * A refusal answers 200 `{ refused: "<reason>" }` and is audited as `blocked`
 * (with `neverList` for C4); the agent reads it and adjusts.
 */
@Injectable()
export class DebriefPmAgentToolsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly reviews: DebriefReviewService,
    private readonly reporting: DebriefReportingService,
    private readonly metrics: DebriefMetricsService,
    private readonly pm: DebriefPmAgentService,
    private readonly ownerSettings: DebriefSettingsService,
    private readonly context: DebriefContextRepository,
    private readonly runner: DebriefRunnerService,
    /** What the agent may do alone per kind and step (PRD §12). */
    @Optional() private readonly autonomy?: DebriefAutonomyService,
    @Optional() private readonly notifier?: DebriefNotifier,
    @Optional()
    private readonly guidanceMetrics?: DebriefGuidanceMetricsService,
  ) {}

  async call(
    tool: PmAgentGatewayTool,
    claims: DebriefAgentClaims,
    body: Record<string, any>,
  ): Promise<Record<string, unknown>> {
    const b = body ?? {};
    try {
      switch (tool) {
        case 'comments_read':
          return await this.reviews.commentsForAgent(b);
        case 'prompt_read':
          return await this.promptRead(b);
        case 'reporting_query':
          return (await this.reporting.query(text(b.sql, 8000))) as any;
        case 'metrics_view':
          return await this.metricsView(b);
        case 'guidance_report':
          return await this.guidanceReport(b);
        case 'idea_propose':
          return await this.ideaPropose(claims, b);
        case 'release_draft':
          return await this.releaseDraft(claims, b);
        case 'ladder_start_quick_test':
          return await this.quickTest(claims, b);
        case 'builder_handoff':
          return await this.builderHandoff(claims, b);
        case 'bug_hunter_report':
          return await this.bugHunterReport(claims, b);
        case 'person_ask':
          return await this.personAsk(claims, b);
        case 'guidance_propose':
          return await this.guidanceProposal(claims, b);
        case 'questions_read':
          return await this.questionsRead();
        case 'question_answer':
          return await this.questionAnswer(claims, b);
        case 'change_review_record':
          return await this.reviewRecord(claims, b);
        default:
          // The conversation's tools are DebriefPmConversationService's.
          return refuse(`${tool} is not a Debrief PM agent run tool`);
      }
    } catch (e) {
      if (e instanceof Refused) {
        await this.pm.audit(
          'blocked',
          UUID.test(b.idea_id ?? '') ? b.idea_id : null,
          null,
          {
            agentRunId: claims.agentRunId,
            tool,
            reason: e.refusal.reason,
            ...(e.refusal.neverList ? { neverList: e.refusal.neverList } : {}),
          },
        );
        return { refused: e.refusal.reason };
      }
      // The ladder's own refusals (budget spent, already running, gone stale).
      if (e instanceof HttpException && e.getStatus() < 500) {
        return this.refusedResult(tool, claims, b, e.message);
      }
      throw e;
    }
  }

  private async refusedResult(
    tool: string,
    claims: DebriefAgentClaims,
    b: Record<string, any>,
    reason: string,
  ) {
    await this.pm.audit(
      'blocked',
      UUID.test(b.idea_id ?? '') ? b.idea_id : null,
      null,
      {
        agentRunId: claims.agentRunId,
        tool,
        reason,
      },
    );
    return { refused: reason };
  }

  // --- reads ------------------------------------------------------------------------

  async metricsView(b: Record<string, any>) {
    const weeks = Math.max(4, Math.min(52, Number(b.weeks) || 8));
    const view = (await this.metrics.view(
      weeks,
      parseMetricsFilter(b),
    )) as unknown as MetricsViewLike;
    return {
      weeks,
      failure_points: metricFailurePoints(view),
      metrics: metricValues(view),
      metric_names: Object.keys(PM_AGENT_METRICS),
      note: 'Thin samples are left out. Cite a point by its name (and segment).',
    };
  }

  /**
   * Debrief Guidance analytics (lookup and guidance agent): the Console's
   * `guidance-metrics` payload. Counts, timings and entry titles only.
   */
  async guidanceReport(b: Record<string, any>) {
    if (!this.guidanceMetrics) refuse('guidance analytics are not available');
    return (await this.guidanceMetrics!.report({
      days: b.days,
      mode: b.mode,
    })) as unknown as Record<string, unknown>;
  }

  // --- ideas ------------------------------------------------------------------------

  private async idea(
    claims: DebriefAgentClaims,
    id: unknown,
    route: Route,
  ): Promise<Record<string, any>> {
    if (typeof id !== 'string' || !UUID.test(id))
      refuse('idea_id is not an idea id');
    const idea = await this.pm.getIdea(id as string).catch(() => null);
    if (!idea) refuse('no such idea; propose it first with idea_propose');
    if (idea!.change?.route !== route) {
      refuse(
        `idea ${id} is on route ${idea!.change?.route ?? '?'}, not ${route}; propose a new idea on route ${route}`,
      );
    }
    if (idea!.status !== 'proposed') refuse(`idea ${id} is ${idea!.status}`);
    return idea!;
  }

  private async requireOn(): Promise<void> {
    if (pmAgentAutonomy(await this.ownerSettings.get()) === 'off') {
      refuse('the Debrief PM agent is switched off (autonomy mode off)');
    }
  }

  async ideaPropose(claims: DebriefAgentClaims, b: Record<string, any>) {
    await this.requireOn();
    const route = b.route as Route;
    if (!['A', 'B', 'C', 'D'].includes(route))
      refuse('route must be A, B, C or D');
    const problem = b.problem ?? {};
    const title = text(b.title, 400);
    const hypothesis = text(b.hypothesis);
    if (
      !title ||
      !hypothesis ||
      !text(problem.title) ||
      !text(problem.summary)
    ) {
      refuse(
        'an idea needs title, hypothesis, problem.title and problem.summary',
      );
    }
    const effect = b.expected_effect ?? {};
    const metric = text(effect.metric, 80);
    if (!(metric in PM_AGENT_METRICS)) {
      refuse(
        `expected_effect.metric must be one of: ${Object.keys(PM_AGENT_METRICS).join(', ')}`,
      );
    }
    if (!['up', 'down'].includes(effect.direction)) {
      refuse('expected_effect.direction must be up or down');
    }
    const asked = (
      Array.isArray(problem.comment_ids) ? problem.comment_ids : []
    )
      .map(String)
      .filter((id: string) => UUID.test(id))
      .slice(0, 50);
    const known: string[] = asked.length
      ? (
          await this.dataSource.query(
            `SELECT id FROM debrief_review_comments WHERE id = ANY($1::uuid[]) AND "parentId" IS NULL`,
            [asked],
          )
        ).map((r: { id: string }) => r.id)
      : [];
    const metricsCited = (Array.isArray(problem.metrics) ? problem.metrics : [])
      .slice(0, 20)
      .map((m: any) => ({
        name: text(m?.name, 80),
        value: m?.value == null ? null : Number(m.value),
        segment: text(m?.segment, 80) || null,
      }))
      .filter((m: { name: string }) => m.name);
    if (!known.length && !metricsCited.length) {
      refuse(
        'an idea needs evidence: at least one existing comment id or one metric (name and value)',
      );
    }
    const [{ n: proposedThisRun }] = await this.dataSource.query(
      `SELECT count(*)::int AS n FROM agent_lesson_audit
        WHERE "agentKey" = $1 AND action = 'proposed' AND detail->>'agentRunId' = $2`,
      [DEBRIEF_AGENT_KEY, claims.agentRunId],
    );
    if (proposedThisRun >= MAX_IDEAS_PER_RUN) {
      refuse(
        `at most ${MAX_IDEAS_PER_RUN} ideas a run; keep the most valuable`,
      );
    }
    // C5: the named metric now, so the outcome can be read against it later.
    const baseline = await this.metricNow(metric).catch(() => null);
    const { id: gaId } = await this.pm.gaBundle();
    const change = {
      ideaKind: ROUTE_KIND[route],
      route,
      promptCode: null,
      find: null,
      replace: null,
      settingKey: null,
      settingValue: null,
      baseReleaseId: gaId,
    };
    const by = effect.by == null ? null : Number(effect.by);
    const expectedEffect = `${metric} ${effect.direction}${by != null && Number.isFinite(by) ? ` by about ${by}` : ''}${text(effect.note, 300) ? ` — ${text(effect.note, 300)}` : ''}`;
    const hash = createHash('sha256')
      .update(
        JSON.stringify({
          t: title.toLowerCase(),
          route,
          p: text(problem.title).toLowerCase(),
        }),
      )
      .digest('hex');
    const rows = await this.dataSource.query(
      `INSERT INTO agent_lessons
         ("agentKey", kind, scope, status, text, change, evidence, "contentHash", "authorKind")
       SELECT $1::varchar, 'lesson', 'platform', 'proposed', $2::varchar, $3::jsonb, $4::jsonb,
              $5::varchar, 'curator'
        WHERE NOT EXISTS (SELECT 1 FROM agent_lessons
                           WHERE "agentKey" = $1::varchar AND "contentHash" = $5::varchar)
       RETURNING id`,
      [
        DEBRIEF_AGENT_KEY,
        title,
        JSON.stringify(change),
        JSON.stringify({
          hypothesis,
          evidence: text(problem.summary),
          expectedEffect,
          problem: {
            title: text(problem.title, 200),
            summary: text(problem.summary),
          },
          commentIds: known,
          metrics: metricsCited,
          forecast: {
            metric,
            direction: effect.direction,
            by: by != null && Number.isFinite(by) ? by : null,
            baseline,
            baselineAt: new Date().toISOString(),
          },
          agentRunId: claims.agentRunId,
          // V2_AUTONOMY A2: the agent's own view is advice; the change's
          // confidence is the reviewer's verdict, low until it answers.
          statedConfidence: changeConfidence(b.confidence),
          confidence: NOT_REVIEWED,
        }),
        hash,
      ],
    );
    const id: string | undefined = rows?.[0]?.id;
    if (!id) {
      const [dup] = await this.dataSource.query(
        `SELECT id, status FROM agent_lessons WHERE "agentKey" = $1 AND "contentHash" = $2`,
        [DEBRIEF_AGENT_KEY, hash],
      );
      refuse(
        `this idea was proposed before (idea ${dup?.id}, ${dup?.status}); only propose it again with new evidence and a new title`,
      );
    }
    const linked = await this.reviews.linkIdea(known, id!);
    await this.pm.audit('proposed', id!, null, {
      agentRunId: claims.agentRunId,
      route,
      kind: change.ideaKind,
    });
    return {
      idea_id: id,
      route,
      linked_comments: linked,
      unknown_comment_ids: asked.filter((c: string) => !known.includes(c)),
      baseline: { metric, value: baseline },
      next:
        route === 'A'
          ? 'release_draft, then ladder_start_quick_test'
          : route === 'B'
            ? 'builder_handoff'
            : route === 'C'
              ? 'bug_hunter_report'
              : 'person_ask (or guidance_propose for a Debrief Guidance entry)',
    };
  }

  /** The named metric's current value over the last 4 weeks (C5). */
  async metricNow(metric: string): Promise<number | null> {
    const view = (await this.metrics.view(4)) as unknown as MetricsViewLike;
    return metricValues(view)[metric] ?? null;
  }

  // --- route A ------------------------------------------------------------------------

  /**
   * A Debrief prompt's live text, as the next run reads it: the version the
   * live release pins, else the Skills Store's current one. Debrief prompts
   * only; read-only (review 2026-11-16: the PM agent could not read the risk
   * cue definition).
   */
  async promptRead(b: Record<string, any>) {
    const code = text(b.code, 120);
    const known = [
      ...new Set([
        ...Object.values(DEBRIEF_PROMPT_CODES),
        // The independent judge's instructions (debrief-run-judge.service).
        'debrief_quality_judge_system',
      ]),
    ];
    if (!known.includes(code)) {
      refuse(`unknown prompt code; known: ${known.join(', ')}`);
    }
    const { bundle } = await this.pm.gaBundle();
    const pinned = bundle.prompts?.[code] ?? null;
    const live = await this.context.promptText(code, pinned);
    if (live == null) refuse(`${code} has no live text`);
    return { code, version: pinned ?? 'current', text: live };
  }

  async releaseDraft(claims: DebriefAgentClaims, b: Record<string, any>) {
    await this.requireOn();
    const idea = await this.idea(claims, b.idea_id, 'A');
    const kind = b.kind as string;
    const { bundle } = await this.pm.gaBundle();
    let change: Record<string, unknown>;
    let lessonKind = 'prompt';
    if (kind === 'prompt_edit') {
      const code = text(b.prompt_code, 120);
      const live = code
        ? await this.context.promptText(code, bundle.prompts[code] ?? null)
        : null;
      const r = promptEditRefusal(code, b.find, b.replace, live);
      if (r) throw new Refused(r);
      if (
        DEBRIEF_ORCHESTRATOR_PROMPT_CODES.includes(code) &&
        !(bundle as { orchestrator?: { enabled?: boolean } }).orchestrator
          ?.enabled
      ) {
        refuse(
          `${code} is the orchestrator's, and the live release does not run the orchestrator, so the change could not be tested`,
        );
      }
      change = {
        ideaKind: 'prompt_edit',
        promptCode: code,
        find: b.find,
        replace: b.replace,
      };
    } else if (kind === 'setting') {
      // roleplayFields is a list: it travels in setting_fields (setting_value is a number).
      const value =
        b.setting_key === ROLEPLAY_FIELDS_KEY
          ? b.setting_fields
          : b.setting_value;
      const r = settingRefusal(b.setting_key, value);
      if (r) throw new Refused(r);
      change = {
        ideaKind: 'setting',
        settingKey: b.setting_key,
        settingValue: settingValueText(b.setting_key, value),
      };
      lessonKind = 'policy';
    } else if (kind === 'registry_agent') {
      const [{ n }] = await this.dataSource.query(
        `SELECT count(*)::int AS n FROM agent_lessons
          WHERE "agentKey" = $1 AND change->>'ideaKind' = 'registry_agent'
            AND status IN ('proposed','approved','active')`,
        [DEBRIEF_AGENT_KEY],
      );
      const catalog = await this.runner.modelCatalog();
      const manifest = b.agent as RegistryAgentManifest;
      const r = registryAgentRefusal(manifest, Number(n), catalog.steps);
      if (r) throw new Refused(r);
      change = {
        ideaKind: 'registry_agent',
        agent: { ...manifest, status: 'experimental', origin: 'system' },
      };
      lessonKind = 'policy';
    } else {
      return refuse('kind must be prompt_edit, setting or registry_agent');
    }
    // R2-18 (FR-56, plan §11.6): what reaches the Writer or learners is backed
    // by enough learners, steers no model and copies no one's words.
    const evidence =
      kind === 'prompt_edit'
        ? await this.contentSafety(idea, b, 'a prompt edit', b.find, b.replace)
        : kind === 'registry_agent'
          ? await this.contentSafety(
              idea,
              b,
              'a system-made agent',
              '',
              [
                b.agent?.description,
                b.agent?.use_when,
                b.agent?.skip_when,
                b.agent?.prompt,
              ]
                .map((v) => (typeof v === 'string' ? v : ''))
                .join('\n'),
            )
          : null;
    const next = { ...idea.change, ...change };
    if (kind !== 'registry_agent') {
      // The change must apply to GA and the challenger bundle must validate.
      try {
        await this.pm.challengerOptions({ ...idea, change: next });
      } catch (e) {
        refuse(`the change does not apply: ${(e as Error).message}`);
      }
    }
    await this.dataSource.query(
      `UPDATE agent_lessons SET change = $2::jsonb, kind = $3, "updatedAt" = now() WHERE id = $1`,
      [idea.id, JSON.stringify(next), lessonKind],
    );
    if (b.confidence) {
      // Advice only: never the change's confidence (the reviewer's verdict).
      await this.pm.writeEvidence(
        idea.id,
        'statedConfidence',
        changeConfidence(b.confidence),
      );
    }
    await this.pm.writeEvidence(idea.id, 'draft', {
      kind,
      draftedAt: new Date().toISOString(),
      agentRunId: claims.agentRunId,
      ...(evidence ?? {}),
    });
    await this.pm.audit('pipeline_step', idea.id, null, {
      agentRunId: claims.agentRunId,
      step: 'release_drafted',
      kind,
    });
    return {
      ok: true,
      idea_id: idea.id,
      kind,
      next:
        kind === 'registry_agent'
          ? 'waits in the Console: registry agents are tested once the agent registry exists'
          : 'ladder_start_quick_test',
    };
  }

  /**
   * The content-safety checks for a self-made change (R2-18; FR-56, plan
   * §11.6), the same three the guidance proposal runs: the evidence rule
   * (platform-wide: 10 learners, 3 organisations), the instruction-pattern
   * filter and the copy check, both on what the change adds. Evidence is the
   * runs behind the idea's cited comments plus any `run_ids` the call names.
   * Refuses, or returns the counts for the draft's record.
   */
  private async contentSafety(
    idea: Record<string, any>,
    b: Record<string, any>,
    what: string,
    before: string,
    after: string,
  ): Promise<{ runIds: string[]; learners: number; tenants: number }> {
    const commentIds: string[] = (idea.evidence?.commentIds ?? []).filter(
      (id: unknown) => typeof id === 'string' && UUID.test(id),
    );
    const fromComments: string[] = (
      await this.dataSource.query(
        `SELECT DISTINCT c."runId" AS run_id FROM debrief_review_comments c
          WHERE c."ideaId" = $1 OR c.id = ANY($2::uuid[])`,
        [idea.id, commentIds],
      )
    )
      .map((r: { run_id: string | null }) => r.run_id)
      .filter((id: unknown): id is string => typeof id === 'string');
    const asked = (Array.isArray(b.run_ids) ? b.run_ids : [])
      .map(String)
      .filter((id: string) => UUID.test(id));
    const runs = await this.evidenceRuns(
      [...new Set([...fromComments, ...asked])].slice(0, MAX_EVIDENCE_RUNS),
    );
    const { learners, tenants } = this.countEvidence(runs);
    const short = changeEvidenceRefusal(what, learners, tenants);
    if (short) throw new Refused(short);
    const pattern = introducedInjectionPattern(before ?? '', after ?? '');
    if (pattern) {
      refuse(
        `${what} must not add instructions that steer or override a model ("${pattern}"); say what the debrief should do in plain words`,
      );
    }
    if (
      introducesSessionText(
        before ?? '',
        after ?? '',
        await this.sessionTurns(idea, runs),
      )
    ) {
      refuse(
        `${what} copies words from a session or a comment; write it in your own words, with no one's quotes`,
      );
    }
    return { runIds: runs.map((r) => r.id), learners, tenants };
  }

  /** Live and shadow runs among `ids`, with their learner and organisation. */
  private async evidenceRuns(ids: string[]): Promise<EvidenceRun[]> {
    return ids.length
      ? this.dataSource.query(
          `SELECT r.id, r."scenarioSessionId" AS session_id,
                  s."counselorId" AS learner, r.tenant_id
             FROM debrief_runs r JOIN scenario_sessions s ON s.id = r."scenarioSessionId"
            WHERE r.id = ANY($1::uuid[]) AND r.mode IN ('live','shadow')`,
          [ids],
        )
      : [];
  }

  private countEvidence(runs: EvidenceRun[]) {
    return {
      learners: new Set(runs.map((r) => r.learner).filter((x) => x != null))
        .size,
      tenants: new Set(runs.map((r) => r.tenant_id).filter(Boolean)).size,
    };
  }

  /** The cited comments' text and the cited runs' turns: words a draft must not copy. */
  private async sessionTurns(
    idea: Record<string, any>,
    runs: EvidenceRun[],
  ): Promise<string[]> {
    const turns: string[] = [...(await this.knownTexts(idea))];
    for (const r of runs) {
      const t = await this.context.transcript(r.session_id).catch(() => []);
      turns.push(...t.map((x) => x.text));
    }
    return turns;
  }

  async quickTest(claims: DebriefAgentClaims, b: Record<string, any>) {
    const mode = pmAgentAutonomy(await this.ownerSettings.get());
    if (mode === 'off')
      refuse('the Debrief PM agent is switched off (autonomy mode off)');
    const idea = await this.idea(claims, b.idea_id, 'A');
    const kind = idea.change?.ideaKind;
    if (kind === 'registry_agent') {
      refuse(
        'registry agents are tested once the agent registry exists (spec step 7)',
      );
    }
    if (kind !== 'prompt_edit' && kind !== 'setting') {
      refuse('draft the change first with release_draft');
    }
    const policy = this.autonomy
      ? await this.autonomy.forIdea(idea, 'quick_test')
      : 'auto';
    if (policy !== 'auto') {
      refuse(
        policy === 'off'
          ? 'quick checks are off for this kind of change'
          : 'this kind of change asks first: a person starts the quick check in the Console; the draft is waiting there',
      );
    }
    const started = await this.pm.screen(idea.id);
    await this.pm.audit('pipeline_step', idea.id, null, {
      agentRunId: claims.agentRunId,
      step: 'quick_test_requested',
    });
    return {
      ...started,
      note: 'ally-be runs the ladder from here: the pass test and the side-by-side trial on their own; a learner try-out follows the policy; a person puts it live for everyone',
    };
  }

  // --- routes B, C, D -------------------------------------------------------------------

  /** Comment bodies, quoted spans and replies the idea cites: never sent to Builder or Bug Hunter. */
  /** The cited comments' bodies and quoted spans: text that never reaches Builder. */
  async knownTexts(idea: Record<string, any>): Promise<string[]> {
    const ids: string[] = idea.evidence?.commentIds ?? [];
    const rows: Array<{ body: string; quotedText: string | null }> =
      await this.dataSource.query(
        `SELECT c.body, c."quotedText" FROM debrief_review_comments c
        WHERE c."ideaId" = $1 OR c.id = ANY($2::uuid[]) OR c."parentId" = ANY($2::uuid[])`,
        [idea.id, ids],
      );
    return rows.flatMap((r) => [r.body, r.quotedText ?? '']).filter(Boolean);
  }

  async builderHandoff(claims: DebriefAgentClaims, b: Record<string, any>) {
    await this.requireOn();
    const idea = await this.idea(claims, b.idea_id, 'B');
    const known = await this.knownTexts(idea);
    let removed = 0;
    const clean = (v: unknown, max = 3000) => {
      const r = stripQuotes(text(v, max), known);
      removed += r.removed;
      return r.text;
    };
    const handoff = {
      problem: clean(b.problem),
      evidenceSummary: clean(b.evidence_summary),
      expectedEffect: clean(b.expected_effect, 1000),
      acceptanceChecks: (Array.isArray(b.acceptance_checks)
        ? b.acceptance_checks
        : []
      )
        .slice(0, 10)
        .map((c: unknown) => clean(c, 400))
        .filter(Boolean),
    };
    const never = handoffNeverListRefusal(
      handoff.problem,
      handoff.evidenceSummary,
      handoff.expectedEffect,
      ...handoff.acceptanceChecks,
    );
    if (never) throw new Refused(never);
    const substance = (s: string) =>
      s.replace(/\[quote removed\]/g, '').trim().length >= 20;
    if (!substance(handoff.problem) || !handoff.acceptanceChecks.length) {
      refuse(
        'the brief needs a problem in your own words (quotes are removed) and at least one acceptance check',
      );
    }
    return this.storeHandoff(claims, idea, {
      kind: 'builder',
      ...handoff,
      quotesRemoved: removed,
    });
  }

  async bugHunterReport(claims: DebriefAgentClaims, b: Record<string, any>) {
    await this.requireOn();
    const idea = await this.idea(claims, b.idea_id, 'C');
    const known = await this.knownTexts(idea);
    const { text: summary, removed } = stripQuotes(
      text(b.summary, 3000),
      known,
    );
    const never = handoffNeverListRefusal(summary);
    if (never) throw new Refused(never);
    if (summary.replace(/\[quote removed\]/g, '').trim().length < 20) {
      refuse(
        'the report needs a summary in your own words (quotes are removed)',
      );
    }
    const asked = (Array.isArray(b.run_ids) ? b.run_ids : [])
      .map(String)
      .filter((id: string) => UUID.test(id))
      .slice(0, 20);
    const runIds: string[] = asked.length
      ? (
          await this.dataSource.query(
            `SELECT id FROM debrief_runs WHERE id = ANY($1::uuid[])`,
            [asked],
          )
        ).map((r: { id: string }) => r.id)
      : [];
    const repo = ['ally-be', 'ally-ai', 'ally-web', 'ally-mobile'].includes(
      b.repo,
    )
      ? b.repo
      : null;
    return this.storeHandoff(claims, idea, {
      kind: 'bug_hunter',
      summary,
      runIds,
      repo,
      quotesRemoved: removed,
    });
  }

  async personAsk(claims: DebriefAgentClaims, b: Record<string, any>) {
    await this.requireOn();
    const idea = await this.idea(claims, b.idea_id, 'D');
    const topics = [
      'rubric',
      'safety',
      'budget',
      'data_access',
      'clinical',
      'product',
      'other',
    ];
    const topic = topics.includes(b.topic) ? b.topic : 'other';
    const question = text(b.question, 1500);
    if (question.length < 10) refuse('ask a question a person can answer');
    const out = await this.storeHandoff(claims, idea, {
      kind: 'person',
      topic,
      question,
      context: text(b.context, 3000),
      // The clinical advisor answers clinical and safety questions; the owner the rest.
      for: ['clinical', 'safety'].includes(topic)
        ? 'clinical_advisor'
        : 'owner',
    });
    // FR-54: every route-D proposal tells the owner.
    await this.notifier?.owner({
      title: 'Debriefs: the Debrief PM agent has a question for a person',
      body: `${idea.text} (${topic})`,
      data: { ideaId: idea.id },
    });
    return out;
  }

  /**
   * Route D (spec C3, C4; plan §11.6 route A's "new knowledge passage" made a
   * person's call): a Debrief Guidance entry the agent thinks should exist
   * or change, drafted for the clinical advisor. Nothing is written to the
   * Context Library — the agent can't (C4); the advisor adds or edits the
   * entry there if they agree, and approving marks the idea answered. The
   * draft must cite runs from at least 10 learners (3 organisations when
   * platform-wide), read as guidance rather than instructions, and copy no
   * session's words.
   */
  async guidanceProposal(claims: DebriefAgentClaims, b: Record<string, any>) {
    await this.requireOn();
    const idea = await this.idea(claims, b.idea_id, 'D');
    const action = b.action === 'change' ? 'change' : 'new';
    const scope = b.scope === 'organisation' ? 'organisation' : 'platform';
    const title = text(b.title, 200);
    const situation = text(b.situation, 600);
    const guidance = text(b.guidance, 2500);
    const why = text(b.why, 1500);
    if (title.length < 5 || situation.length < 10 || guidance.length < 40) {
      refuse(
        'a guidance proposal needs a title, the situation it is for, and the guidance itself (at least 40 characters)',
      );
    }
    let existing: { code: string; title: string } | null = null;
    if (action === 'change') {
      const code = text(b.existing_code, 40);
      if (!/^DG-\d+$/i.test(code)) {
        refuse('a change names the entry it changes by its code (DG-…)');
      }
      const [row] = await this.dataSource.query(
        `SELECT code, title FROM cl_chunks WHERE upper(code) = upper($1)`,
        [code],
      );
      if (!row) refuse(`there is no Debrief Guidance entry ${code}`);
      existing = { code: row.code, title: row.title };
    }
    const asked = (Array.isArray(b.run_ids) ? b.run_ids : [])
      .map(String)
      .filter((id: string) => UUID.test(id))
      .slice(0, 50);
    const runs = await this.evidenceRuns(asked);
    const { learners, tenants } = this.countEvidence(runs);
    const evidence = guidanceEvidenceRefusal(scope, learners, tenants);
    if (evidence) throw new Refused(evidence);
    const draft = [title, situation, guidance, why].join('\n');
    const pattern = instructionPatternIn(draft);
    if (pattern) {
      refuse(
        `the draft reads as instructions to a model ("${pattern}"); write guidance for a counsellor`,
      );
    }
    // Plan §11.6: never a learner's (or the simulated client's) own words.
    if (copiesSessionText(draft, await this.sessionTurns(idea, runs))) {
      refuse(
        "the draft copies words from a session or a comment; write it in your own words, with no one's quotes",
      );
    }
    const out = await this.storeHandoff(claims, idea, {
      kind: 'guidance',
      action,
      scope,
      ...(existing
        ? { existingCode: existing.code, existingTitle: existing.title }
        : {}),
      title,
      situation,
      guidance,
      why,
      runIds: runs.map((r) => r.id),
      learners,
      tenants,
      // Clinical content is the clinical advisor's (route D).
      for: 'clinical_advisor',
    });
    // FR-54: every route-D proposal tells the owner.
    await this.notifier?.owner({
      title: 'Debriefs: the Debrief PM agent proposes a Debrief Guidance entry',
      body: `${action === 'change' ? `A change to ${existing!.code}` : 'A new entry'}: ${title}`,
      data: { ideaId: idea.id },
    });
    return {
      ...out,
      note: 'Nothing was written to the Context Library; the clinical advisor decides and adds it there.',
    };
  }

  // --- "Ask a question" (plan §11.7, spec C5) -------------------------------------------

  /**
   * `change_review_record`: the reviewer subagent's verdict on one change,
   * posted by ally-ai's code after the reviewer answers (never a model tool).
   * Sets `evidence.confidence` (read by the always-ask check), keeps the
   * answers in `evidence.review`.
   */
  async reviewRecord(claims: DebriefAgentClaims, b: Record<string, any>) {
    if (typeof b.idea_id !== 'string' || !UUID.test(b.idea_id)) {
      refuse('idea_id is not an idea id');
    }
    const idea = await this.pm.getIdea(b.idea_id).catch(() => null);
    if (!idea) refuse('no such change');
    if (!['proposed', 'approved'].includes(idea!.status)) {
      refuse(`the change is ${idea!.status}; a review changes nothing now`);
    }
    const { confidence, answers } = reviewConfidence(b);
    await this.pm.writeEvidence(idea!.id, 'confidence', confidence);
    await this.pm.writeEvidence(idea!.id, 'review', {
      ...answers,
      level: confidence.level,
      at: new Date().toISOString(),
      agentRunId: claims.agentRunId,
    });
    await this.pm.audit('pipeline_step', idea!.id, null, {
      agentRunId: claims.agentRunId,
      step: 'change_reviewed',
      level: confidence.level,
    });
    return { ok: true, level: confidence.level, why: confidence.why };
  }

  /** Questions people asked on the agent's ideas that it has not answered yet. */
  async questionsRead() {
    const questions = await this.pm.openQuestions();
    return {
      questions,
      note: 'Answer each with question_answer: plain words, under 150 words, citing numbers and ids, never learner words.',
    };
  }

  /** The agent's answer, posted back to the idea's question thread. */
  async questionAnswer(claims: DebriefAgentClaims, b: Record<string, any>) {
    await this.requireOn();
    if (typeof b.idea_id !== 'string' || !UUID.test(b.idea_id)) {
      refuse('idea_id is not an idea id');
    }
    const answer = text(b.answer, 1500);
    if (answer.length < 2) refuse('write the answer');
    return this.pm.answerQuestion(
      b.idea_id,
      typeof b.question_id === 'string' ? b.question_id : null,
      answer,
      claims.agentRunId,
    );
  }

  private async storeHandoff(
    claims: DebriefAgentClaims,
    idea: Record<string, any>,
    handoff: Record<string, unknown>,
  ) {
    await this.pm.writeEvidence(idea.id, 'handoff', {
      ...handoff,
      status: 'waiting',
      at: new Date().toISOString(),
      agentRunId: claims.agentRunId,
    });
    await this.pm.audit('pipeline_step', idea.id, null, {
      agentRunId: claims.agentRunId,
      step: `${handoff.kind}_handoff`,
    });
    // V2_AUTONOMY A8: Builder and Bug Hunter start on their own; a Builder
    // pull request still waits for an engineer to merge.
    if (handoff.kind === 'builder' || handoff.kind === 'bug_hunter') {
      const started = await this.pm.autoStartHandoff(idea.id);
      return {
        ok: true,
        idea_id: idea.id,
        started: started.started,
        ...(started.started
          ? {
              waiting_for:
                handoff.kind === 'builder'
                  ? 'nobody: Builder started; its pull request waits for an engineer to merge'
                  : 'nobody: the bug was filed for Bug Hunter',
            }
          : {
              waiting_for: `a person in the Debrief Console (${started.reason})`,
            }),
        ...(typeof handoff.quotesRemoved === 'number'
          ? { quotes_removed: handoff.quotesRemoved }
          : {}),
      };
    }
    return {
      ok: true,
      idea_id: idea.id,
      waiting_for: 'a person to approve it in the Debrief Console',
      ...(typeof handoff.quotesRemoved === 'number'
        ? { quotes_removed: handoff.quotesRemoved }
        : {}),
    };
  }
}
