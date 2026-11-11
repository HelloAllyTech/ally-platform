import { HttpException, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { DataSource } from 'typeorm';
import {
  DEBRIEF_AGENT_KEY,
  DEBRIEF_ORCHESTRATOR_PROMPT_CODES,
} from '../constants/debrief-release.constants';
import { pmAgentAutonomy } from '../constants/debrief-owner-settings.constants';
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
  ROUTE_KIND,
  settingRefusal,
  stripQuotes,
} from '../util/debrief-pm-agent-rules.util';
import {
  DebriefAgentClaims,
  PmAgentGatewayTool,
} from './debrief-run-token.service';
import { DebriefContextRepository } from './debrief-context.repository';
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
        case 'reporting_query':
          return (await this.reporting.query(text(b.sql, 8000))) as any;
        case 'metrics_view':
          return await this.metricsView(b);
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
      refuse('the PM agent is switched off (autonomy mode off)');
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
              : 'person_ask',
    };
  }

  /** The named metric's current value over the last 4 weeks (C5). */
  async metricNow(metric: string): Promise<number | null> {
    const view = (await this.metrics.view(4)) as unknown as MetricsViewLike;
    return metricValues(view)[metric] ?? null;
  }

  // --- route A ------------------------------------------------------------------------

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
      const r = settingRefusal(b.setting_key, b.setting_value);
      if (r) throw new Refused(r);
      change = {
        ideaKind: 'setting',
        settingKey: b.setting_key,
        settingValue: String(Number(b.setting_value)),
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
    await this.pm.writeEvidence(idea.id, 'draft', {
      kind,
      draftedAt: new Date().toISOString(),
      agentRunId: claims.agentRunId,
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

  async quickTest(claims: DebriefAgentClaims, b: Record<string, any>) {
    const mode = pmAgentAutonomy(await this.ownerSettings.get());
    if (mode === 'off')
      refuse('the PM agent is switched off (autonomy mode off)');
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
    if (mode === 'propose_only') {
      refuse(
        'propose-only mode: a person starts the quick test in the Console; the draft is waiting there',
      );
    }
    const started = await this.pm.screen(idea.id);
    await this.pm.audit('pipeline_step', idea.id, null, {
      agentRunId: claims.agentRunId,
      step: 'quick_test_requested',
    });
    return {
      ...started,
      note: 'ally-be runs the ladder from here: gate, paired trials, canary; a person starts the canary and promotes',
    };
  }

  // --- routes B, C, D -------------------------------------------------------------------

  /** Comment bodies, quoted spans and replies the idea cites: never sent to Builder or Bug Hunter. */
  private async knownTexts(idea: Record<string, any>): Promise<string[]> {
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
    return this.storeHandoff(claims, idea, {
      kind: 'person',
      topic,
      question,
      context: text(b.context, 3000),
      // The clinical advisor answers clinical and safety questions; the owner the rest.
      for: ['clinical', 'safety'].includes(topic)
        ? 'clinical_advisor'
        : 'owner',
    });
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
