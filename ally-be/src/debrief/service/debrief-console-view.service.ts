import { DebriefRunStepRecord } from '../entity/debrief-run.entity';
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { scheduledTaskRegistry } from '../../scheduler/registry/scheduled-task.registry';
import { DebriefNotifier } from './debrief-notifier.service';
import { DebriefReleasesService } from './debrief-releases.service';
import { ModuleRef } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { PermissionsService } from '../../authorization/service/permissions.service';
import { FeatureToggleService } from '../../authorization/service/feature-toggle.service';
import { FeatureToggleKey } from '../../authorization/constants/admin-feature-toggle.constants';
import { AppConfigService } from '../../config/config.service';
import { DEBRIEF_SEED_BUNDLE } from '../constants/debrief-release.constants';
import { CHECK_FALLBACK } from '../constants/debrief-reply.constants';
import { DebriefRun } from '../entity/debrief-run.entity';
import {
  canDecideFlag,
  debriefCan,
  debriefRoles,
  DebriefViewer,
} from '../util/debrief-console-roles.util';
import {
  approvalState,
  changeKindOf,
  ideaState,
  COST_BAND_USD,
  heldReasons,
  HIT_CEILING_SHARE,
  pendingActions,
  PINNED_RULE_PROMPTS,
  SessionFilters,
} from '../util/debrief-console-view.util';
import { DebriefCards } from '../util/debrief-cards.util';
import { DebriefConsoleService } from './debrief-console.service';
import { DebriefContextRepository } from './debrief-context.repository';
import {
  ASK_ALLY_SECTION,
  cardAt,
  correctableFields,
  DebriefFeedbackService,
  FLAG_UNDO_MS,
  sectionText,
} from './debrief-feedback.service';
import { DebriefPmAgentService } from './debrief-pm-agent.service';
import { DebriefReviewService } from './debrief-review.service';
import { DebriefSettingsService } from './debrief-settings.service';
import { DebriefAutonomyService } from './debrief-autonomy.service';
import { DebriefAgreementService } from './debrief-agreement.service';

const num = (v: unknown, d = 2) =>
  v == null || !Number.isFinite(Number(v))
    ? null
    : Math.round(Number(v) * 10 ** d) / 10 ** d;
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

/** Calibration sample membership, as the session list and view read it. */
interface ScoringSample {
  inSample: Set<string>;
  ratedByMe: Set<string>;
}

/**
 * Read models for the redesigned Debrief console (debrief-console-redesign-
 * notes.md): the viewer's roles and allowed actions, the home list with its
 * categories, filters and queue order, one session with everything the
 * session view draws (pending actions per role with anchors), the attention
 * banners, Analytics › Debriefs, pinned rules and the PM agent's approvals.
 * No redaction: the console shows the real context.
 */
@Injectable()
export class DebriefConsoleViewService implements OnModuleInit {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(DebriefRun)
    private readonly runs: Repository<DebriefRun>,
    private readonly permissions: PermissionsService,
    private readonly toggles: FeatureToggleService,
    private readonly console: DebriefConsoleService,
    private readonly context: DebriefContextRepository,
    private readonly feedback: DebriefFeedbackService,
    private readonly reviews: DebriefReviewService,
    private readonly pmAgent: DebriefPmAgentService,
    private readonly settings: DebriefSettingsService,
    private readonly autonomy: DebriefAutonomyService,
    private readonly agreement: DebriefAgreementService,
    private readonly config: AppConfigService,
    private readonly moduleRef: ModuleRef,
    @Optional() private readonly notifier?: DebriefNotifier,
    @Optional() private readonly releasesView?: DebriefReleasesService,
  ) {}

  onModuleInit(): void {
    // FR-54: the Ally team hears about approvals in their last 3 days and
    // urgent items past the review deadline, once each.
    // When this runs is set in Debrief › Settings › Schedules (debrief_schedules).
    scheduledTaskRegistry.registerConfigurable('debrief-console-alerts', () =>
      this.notifyDue().then(({ approvals, urgent }) => {
        const n = approvals + urgent;
        return `${n} alert${n === 1 ? '' : 's'}`;
      }),
    );
  }

  /**
   * In-app notifications that wait on a person (FR-54): an approval entering
   * its last 3 days (once per idea), an urgent item past `flagReviewSlaHours`
   * (once per run). Returns how many it sent.
   */
  async notifyDue(
    now = new Date(),
  ): Promise<{ approvals: number; urgent: number }> {
    if (!this.notifier) return { approvals: 0, urgent: 0 };
    let approvals = 0;
    let urgent = 0;
    const ideas: Array<Record<string, any>> = await this.dataSource.query(
      `SELECT id, status, text, change, evidence, "createdAt" FROM agent_lessons
        WHERE "agentKey" = 'debrief' AND status IN ('proposed','approved')
          AND NOT (coalesce(evidence, '{}'::jsonb) ? 'expiryWarning')`,
    );
    for (const i of ideas) {
      const a = approvalState(i as any, now);
      if (!a?.expiringSoon) continue;
      const alert = {
        title: `Debriefs: an approval expires in ${a.expiresInDays} day(s)`,
        body: `"${i.text}" expires with no decision on ${a.expiresAt.slice(0, 10)}.`,
        data: { ideaId: i.id },
      };
      await this.notifier.team(alert);
      if (a.wait === 'pinned_rule') await this.notifier.owner(alert);
      await this.pmAgent.writeEvidence(i.id, 'expiryWarning', {
        at: now.toISOString(),
        expiresAt: a.expiresAt,
      });
      approvals++;
    }
    const s = await this.settings.get();
    const params: unknown[] = [];
    const base = this.baseSql(
      { category: 'needs', mode: 'live', limit: 500, offset: 0 },
      params,
    );
    params.push(s.flagReviewSlaHours);
    const slaParam = '$' + params.length;
    const rows: Array<Record<string, any>> = await this.dataSource.query(
      `${base}
       SELECT ranked.id, ranked."scenarioTitle", COALESCE(ranked.flag_since, ranked."createdAt") AS since
         FROM ranked JOIN debrief_runs dr ON dr.id = ranked.id
        WHERE ranked.rank = 0
          AND COALESCE(ranked.flag_since, ranked."createdAt") < now() - make_interval(hours => ${slaParam})
          AND NOT (coalesce(dr.workspace, '{}'::jsonb) ? 'overdueNotifiedAt')`,
      params,
    );
    for (const r of rows) {
      await this.notifier.team({
        title: 'Debriefs: an urgent item is past its review deadline',
        body: `${r.scenarioTitle ?? 'A session'} has waited since ${new Date(r.since).toISOString().slice(0, 16).replace('T', ' ')} UTC.`,
        data: { runId: r.id },
      });
      await this.dataSource.query(
        `UPDATE debrief_runs
            SET workspace = jsonb_set(coalesce(workspace, '{}'::jsonb), '{overdueNotifiedAt}', to_jsonb($2::text))
          WHERE id = $1`,
        [r.id, now.toISOString()],
      );
      urgent++;
    }
    return { approvals, urgent };
  }

  // --- The viewer -------------------------------------------------------------------

  async viewer(userId: number): Promise<DebriefViewer> {
    const [perms, keys, rated] = await Promise.all([
      this.permissions.getUserPermissions(userId),
      this.toggles.getEnabledKeys(userId).catch(() => [] as string[]),
      this.dataSource
        .query(
          `SELECT EXISTS (SELECT 1 FROM debrief_human_ratings WHERE "raterId" = $1) AS rated`,
          [userId],
        )
        .then((r: Array<{ rated: boolean }>) => !!r?.[0]?.rated)
        .catch(() => false),
    ]);
    const roles = debriefRoles(
      perms,
      keys.includes(FeatureToggleKey.DEBRIEF_CLINICAL_SIGN_OFF),
    );
    const can = debriefCan(perms);
    return {
      userId,
      roles,
      can,
      scorer: roles.clinicalAdvisor || (can.score && rated),
    };
  }

  /** May this viewer decide this flag? 403 otherwise (an advisor: only escalated flags). */
  async assertFlagDecision(flagId: string, viewer: DebriefViewer) {
    const [f] = await this.dataSource.query(
      `SELECT status FROM debrief_run_feedback WHERE id = $1 AND kind = 'flag'`,
      [flagId],
    );
    if (!f) throw new NotFoundException('Flag not found');
    if (!canDecideFlag(viewer, f.status)) {
      throw new ForbiddenException(
        'The clinical advisor decides only flags escalated to them',
      );
    }
  }

  // --- Scoring sample ------------------------------------------------------------------

  private async calibration() {
    const { DebriefCalibrationService } =
      await import('../../analytics/service/debrief-calibration.service');
    return this.moduleRef.get(DebriefCalibrationService, { strict: false });
  }

  private async scoringSample(userId: number): Promise<ScoringSample> {
    try {
      const sample = await (await this.calibration()).getSample(userId);
      return {
        inSample: new Set(sample.items.map((i) => i.scenarioSessionId)),
        ratedByMe: new Set(
          sample.items
            .filter((i) => i.ratedByMe)
            .map((i) => i.scenarioSessionId),
        ),
      };
    } catch {
      return { inSample: new Set(), ratedByMe: new Set() };
    }
  }

  /**
   * Score by hand from the session view: the clinical advisor on any session
   * the judge scored; an Ally team reviewer only on sessions in the scoring
   * sample. Stored as the calibration set's rating (it feeds the κ gate).
   */
  async score(
    sessionId: string,
    viewer: DebriefViewer,
    input: {
      scores: Record<string, number>;
      hardFails: string[];
      note?: string | null;
    },
  ) {
    if (!viewer.roles.clinicalAdvisor) {
      const sample = await this.scoringSample(viewer.userId);
      if (!sample.inSample.has(sessionId)) {
        throw new ForbiddenException(
          'The Ally team scores only sessions in the scoring sample',
        );
      }
    }
    return (await this.calibration()).submit(viewer.userId, sessionId, input);
  }

  // --- Home list --------------------------------------------------------------------

  /**
   * One row per run with everything the home list, its categories and its
   * queue order need. `rank`: 0 urgent (a flag on an important moment, an
   * Ask Ally distress item, an escalated flag, or learner distress not yet
   * checked), 1 another open flag, 2 held or below the bar and not reviewed,
   * 3 the rest. Only live runs can need a person.
   */
  private baseSql(f: SessionFilters, params: unknown[]): string {
    const p = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };
    const undo = p(Math.round(FLAG_UNDO_MS / 1000));
    const pass = p(DEBRIEF_SEED_BUNDLE.settings.passScore);
    const where: string[] = [];
    if (f.mode === 'production') where.push(`r.mode IN ('shadow','live')`);
    else if (f.mode !== 'any') where.push(`r.mode = ${p(f.mode)}`);
    if (f.tenantId) where.push(`r.tenant_id = ${p(f.tenantId)}`);
    if (f.language) where.push(`r.language = ${p(f.language)}`);
    if (f.recipe) where.push(`r."recipeKey" = ${p(f.recipe)}`);
    if (f.fallback === 'none') where.push(`r."fallbackRung" = 0`);
    if (f.fallback === 'light') where.push(`r."fallbackRung" BETWEEN 1 AND 2`);
    if (f.fallback === 'heavy') where.push(`r."fallbackRung" >= 3`);
    if (f.riskCue !== undefined) {
      where.push(f.riskCue ? `r."hasRiskCue"` : `NOT r."hasRiskCue"`);
    }
    const cost = `COALESCE(r."actualCostUsd", r."estimatedCostUsd")::float`;
    if (f.cost === 'over_0_20') where.push(`${cost} > ${p(COST_BAND_USD)}`);
    if (f.cost === 'hit_ceiling') {
      where.push(
        `r."ceilingUsd" IS NOT NULL AND ${cost} >= r."ceilingUsd"::float * ${p(HIT_CEILING_SHARE)}`,
      );
    }
    // PRD §6.6: a flag on an important moment is work at once, as urgent;
    // other flags only once the learner's 10-minute undo window has passed.
    const open = `(f.status = 'escalated' OR (f.status = 'open' AND (f.urgent OR f."updatedAt" < now() - make_interval(secs => ${undo}))))`;
    return `
      WITH fl AS (
        SELECT f."runId",
               bool_or(${open} AND f.urgent) AS urgent_open,
               bool_or(${open}) AS any_open,
               bool_or(f.status = 'escalated') AS escalated_flag,
               bool_or(f.section IS DISTINCT FROM '${ASK_ALLY_SECTION}' AND f.status <> 'withdrawn') AS flagged,
               bool_or(f.section LIKE 'important_moment%' AND f.status <> 'withdrawn') AS important_flagged,
               count(*) FILTER (WHERE f.section IS DISTINCT FROM '${ASK_ALLY_SECTION}' AND f.status <> 'withdrawn')::int AS flag_count,
               min(f."createdAt") FILTER (WHERE ${open}) AS flag_since
          FROM debrief_run_feedback f
         WHERE f.kind = 'flag'
         GROUP BY f."runId"
      ), b AS (
        SELECT r.id, r."scenarioSessionId", r.mode, r.status, r."skipReason", r."recipeKey",
               r."releaseVersion", r.language, r."hasRiskCue", r."learnerDistress",
               r."fallbackRung", r."evaluatorOverall"::float AS "evaluatorOverall",
               (r.workspace->'judge'->>'overall')::float AS "judgeOverall",
               ${cost} AS "costUsd", r."ceilingUsd"::float AS "ceilingUsd",
               extract(epoch FROM r."finishedAt" - r."startedAt")::int AS seconds,
               r."createdAt", r.tenant_id AS "tenantId", t.name AS "tenantName",
               sc.title AS "scenarioTitle", s."scenarioId" AS "scenarioId",
               (r.workspace ? 'review') AS reviewed,
               EXISTS (SELECT 1 FROM debrief_agreement_samples ags WHERE ags."runId" = r.id) AS agreement_sample,
               EXISTS (SELECT 1 FROM debrief_reviews dv WHERE dv."runId" = r.id) AS has_verdict,
               (r.workspace ? 'escalation' AND NOT (r.workspace ? 'review')) AS run_escalated,
               (r.workspace->'escalation'->>'at') AS escalated_at,
               (r.workspace ? 'judge' AND (
                  (r.workspace->'judge'->>'overall')::float < ${pass}
                  OR jsonb_array_length(coalesce(r.workspace->'judge'->'hardFails', '[]'::jsonb)) > 0)) AS judge_below,
               COALESCE(fl.urgent_open, false) AS urgent_open,
               COALESCE(fl.any_open, false) AS any_open,
               COALESCE(fl.escalated_flag, false) AS escalated_flag,
               COALESCE(fl.flagged, false) AS flagged,
               COALESCE(fl.important_flagged, false) AS important_flagged,
               COALESCE(fl.flag_count, 0) AS flag_count,
               fl.flag_since
          FROM debrief_runs r
          LEFT JOIN fl ON fl."runId" = r.id
          LEFT JOIN tenants t ON t.id::text = r.tenant_id
          LEFT JOIN scenario_sessions s ON s.id = r."scenarioSessionId"
          LEFT JOIN scenarios sc ON sc.id = s."scenarioId"
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ), ranked AS (
        SELECT b.*,
               CASE
                 WHEN b.mode = 'live' AND (b.urgent_open OR (b."learnerDistress" AND NOT b.reviewed)) THEN 0
                 WHEN b.mode = 'live' AND b.any_open THEN 1
                 WHEN b.mode = 'live' AND NOT b.reviewed
                      AND (b.status IN ('needs_person','below_bar','failed')
                           OR (b.status = 'published' AND b.judge_below)) THEN 2
                 ELSE 3
               END AS rank,
               (b.mode = 'live' AND (b.escalated_flag OR b.run_escalated)) AS escalated
          FROM b
      )`;
  }

  private categorySql(cat: SessionFilters['category'], sampleParam: string) {
    switch (cat) {
      case 'needs':
        return `rank < 3`;
      case 'flagged':
        return `flagged`;
      case 'below':
        return `(status = 'below_bar' OR (status = 'published' AND judge_below))`;
      case 'published':
        return `status = 'published'`;
      case 'escalated':
        return `escalated`;
      case 'to_score':
        return `"scenarioSessionId" = ANY(${sampleParam}::uuid[])`;
      case 'agreement_sample':
        return `(agreement_sample AND NOT has_verdict)`;
      default:
        return `true`;
    }
  }

  /**
   * The home list (PRD §10): a category, the filters, and per row the flags
   * the cards show. "Needs a person" is in queue order — urgent, other flags,
   * held or below the bar, oldest wait first; a clinical advisor who is not
   * on the Ally team gets what was escalated to them instead. Counts per
   * category use the same filters.
   */
  async sessions(f: SessionFilters, viewer: DebriefViewer) {
    const params: unknown[] = [];
    const base = this.baseSql(f, params);
    const sample = viewer.can.score
      ? await this.scoringSample(viewer.userId)
      : { inSample: new Set<string>(), ratedByMe: new Set<string>() };
    const toScore = [...sample.inSample].filter(
      (id) => !sample.ratedByMe.has(id),
    );
    params.push(toScore);
    const sampleParam = `$${params.length}`;
    const countParams = [...params];
    const [counts] = await this.dataSource.query(
      `${base}
       SELECT count(*) FILTER (WHERE rank < 3)::int AS needs,
              count(*) FILTER (WHERE rank = 0)::int AS urgent,
              count(*) FILTER (WHERE flagged)::int AS flagged,
              count(*) FILTER (WHERE status = 'below_bar' OR (status = 'published' AND judge_below))::int AS below,
              count(*) FILTER (WHERE status = 'published')::int AS published,
              count(*) FILTER (WHERE escalated)::int AS escalated,
              count(*) FILTER (WHERE "scenarioSessionId" = ANY(${sampleParam}::uuid[]))::int AS to_score,
              count(*) FILTER (WHERE agreement_sample AND NOT has_verdict)::int AS agreement_sample,
              count(*)::int AS "all"
         FROM ranked`,
      countParams,
    );
    const queueOrder = `rank ASC, COALESCE(flag_since, "createdAt") ASC`;
    const order =
      f.category === 'needs' || f.category === 'escalated'
        ? queueOrder
        : `"createdAt" DESC`;
    // Only the "To score" category reads the sample; an unreferenced
    // parameter has no type and Postgres rejects the whole query.
    const rowParams =
      f.category === 'to_score' ? [...params] : params.slice(0, -1);
    const rowSampleParam =
      f.category === 'to_score' ? sampleParam : 'NULL::uuid[]';
    rowParams.push(f.limit, f.offset);
    const rows: Array<Record<string, any>> = await this.dataSource.query(
      `${base}
       SELECT * FROM ranked
        WHERE ${this.categorySql(f.category, rowSampleParam)}
        ORDER BY ${order}
        LIMIT $${rowParams.length - 1} OFFSET $${rowParams.length}`,
      rowParams,
    );
    return {
      category: f.category,
      counts: {
        needs: Number(counts?.needs ?? 0),
        urgent: Number(counts?.urgent ?? 0),
        flagged: Number(counts?.flagged ?? 0),
        below: Number(counts?.below ?? 0),
        published: Number(counts?.published ?? 0),
        escalated: Number(counts?.escalated ?? 0),
        toScore: viewer.scorer ? Number(counts?.to_score ?? 0) : null,
        // Only for whoever gives verdicts (the clinical advisor).
        agreementSample: viewer.can.verdict
          ? Number(counts?.agreement_sample ?? 0)
          : null,
        all: Number(counts?.all ?? 0),
      },
      items: rows.map((r) => this.toItem(r, sample)),
      filterOptions: await this.filterOptions(),
      viewer: this.viewerPayload(viewer),
    };
  }

  private toItem(r: Record<string, any>, sample: ScoringSample) {
    const rank = Number(r.rank);
    return {
      runId: r.id,
      sessionId: r.scenarioSessionId,
      scenario: { id: r.scenarioId ?? null, title: r.scenarioTitle ?? null },
      tenantId: r.tenantId ?? null,
      tenantName: r.tenantName ?? null,
      language: r.language ?? null,
      recipe: r.recipeKey ?? null,
      mode: r.mode,
      status: r.status,
      skipReason: r.skipReason ?? null,
      releaseVersion: r.releaseVersion ?? null,
      judgeOverall: num(r.judgeOverall),
      evaluatorOverall: num(r.evaluatorOverall),
      costUsd: num(r.costUsd, 4),
      ceilingUsd: num(r.ceilingUsd, 4),
      seconds: r.seconds ?? null,
      fallbackRung: Number(r.fallbackRung ?? 0),
      createdAt: iso(r.createdAt),
      rank,
      needsPerson: rank < 3,
      urgent: rank === 0,
      flagged: !!r.flagged,
      flagCount: Number(r.flag_count ?? 0),
      importantMomentFlagged: !!r.important_flagged,
      escalated: !!r.escalated,
      riskCue: !!r.hasRiskCue,
      learnerDistress: !!r.learnerDistress,
      belowBar:
        r.status === 'below_bar' ||
        (r.status === 'published' && !!r.judge_below),
      reviewed: !!r.reviewed,
      agreementSample: !!r.agreement_sample && !r.has_verdict,
      inMyScoringSample: sample.inSample.has(r.scenarioSessionId),
      toScore:
        sample.inSample.has(r.scenarioSessionId) &&
        !sample.ratedByMe.has(r.scenarioSessionId),
      waitingSince: rank < 3 ? iso(r.flag_since ?? r.createdAt) : null,
    };
  }

  private async filterOptions() {
    const [tenants, languages, recipes] = await Promise.all([
      this.dataSource.query(
        `SELECT DISTINCT r.tenant_id AS id, t.name FROM debrief_runs r
           LEFT JOIN tenants t ON t.id::text = r.tenant_id
          WHERE r.tenant_id IS NOT NULL ORDER BY t.name NULLS LAST LIMIT 200`,
      ),
      this.dataSource.query(
        `SELECT DISTINCT language AS v FROM debrief_runs WHERE language IS NOT NULL ORDER BY 1`,
      ),
      this.dataSource.query(
        `SELECT DISTINCT "recipeKey" AS v FROM debrief_runs WHERE "recipeKey" IS NOT NULL ORDER BY 1`,
      ),
    ]);
    return {
      tenants: (tenants as Array<{ id: string; name: string | null }>).map(
        (t) => ({ id: t.id, name: t.name ?? t.id }),
      ),
      languages: (languages as Array<{ v: string }>).map((l) => l.v),
      recipes: (recipes as Array<{ v: string }>).map((l) => l.v),
      fallback: ['none', 'light', 'heavy'],
      riskCue: [true, false],
      cost: ['over_0_20', 'hit_ceiling'],
      modes: ['production', 'live', 'shadow', 'replay', 'any'],
    };
  }

  /** The viewer's queue in order (Previous / Next, j / k): the Ally team's, or the advisor's escalations. */
  private async queueIds(viewer: DebriefViewer): Promise<string[]> {
    const advisorOnly =
      !viewer.roles.allyTeam &&
      !viewer.roles.owner &&
      viewer.roles.receivesEscalations;
    const params: unknown[] = [];
    const base = this.baseSql(
      { category: 'needs', mode: 'live', limit: 500, offset: 0 },
      params,
    );
    const rows: Array<{ id: string }> = await this.dataSource.query(
      `${base}
       SELECT id FROM ranked WHERE ${advisorOnly ? 'escalated' : 'rank < 3'}
        ORDER BY rank ASC, COALESCE(flag_since, "createdAt") ASC LIMIT 500`,
      params,
    );
    return rows.map((r) => r.id);
  }

  private viewerPayload(viewer: DebriefViewer) {
    return { roles: viewer.roles, can: viewer.can, scorer: viewer.scorer };
  }

  // --- One session --------------------------------------------------------------------

  /**
   * Everything the session view draws for one run, in one payload: the
   * session and scenario, the transcript (real names, risk cues), the cards
   * with their versions and the learner's corrections, flags, Ask Ally,
   * learner distress, the skill estimate (shown only here), how it was made,
   * the judge's reasons, comments, scoring, the queue position, and what this
   * viewer's role must decide now with its anchors.
   */
  /**
   * PRD §14: each guidance step names the Debrief Guidance entries it used by
   * code (`DG-…`). Runs record them on the step; a run from before that has
   * only the passages' ids, read back to codes here (a missing entry is left
   * out, never guessed).
   */
  private async withGuidanceCodes(
    steps: DebriefRunStepRecord[],
    passageIds: string[],
  ): Promise<DebriefRunStepRecord[]> {
    const lookup = steps.findIndex(
      (x) => x.step === 'guidance_lookup' && !x.citations,
    );
    if (lookup < 0 || passageIds.length === 0) return steps;
    let rows: Array<{ code: string; title: string }> = [];
    try {
      rows = await this.dataSource.query(
        `SELECT code, title FROM cl_chunks WHERE id::text = ANY($1::text[])
          ORDER BY array_position($1::text[], id::text)`,
        [passageIds],
      );
    } catch {
      return steps;
    }
    const out = [...steps];
    out[lookup] = {
      ...out[lookup],
      citations: rows.map((r) => ({ code: r.code, title: r.title })),
    };
    return out;
  }

  async session(runId: string, viewer: DebriefViewer) {
    const run = await this.runs.findOne({ where: { id: runId } });
    if (!run) throw new NotFoundException('Run not found');
    const [meta] = await this.dataSource.query(
      `SELECT s.id, s."scenarioId", sc.title AS "scenarioTitle", s."counselorId" AS "learnerId",
              u.name AS "learnerName", u.metadata->>'workerType' AS "learnerLevel",
              s."createdAt" AS "startedAt", s."endedAt", t.name AS "tenantName"
         FROM scenario_sessions s
         LEFT JOIN scenarios sc ON sc.id = s."scenarioId"
         LEFT JOIN users u ON u.id = s."counselorId"
         LEFT JOIN tenants t ON t.id::text = s.tenant_id
        WHERE s.id = $1`,
      [run.scenarioSessionId],
    );
    const [
      transcript,
      flagRows,
      comments,
      earlierComments,
      thread,
      sample,
      queue,
      ownerSettings,
    ] = await Promise.all([
      this.reviews.reviewTranscript(run).catch(() => []),
      this.dataSource.query(
        `SELECT f.*, u.name AS "resolvedByName" FROM debrief_run_feedback f
             LEFT JOIN users u ON u.id = f."resolvedBy"
            WHERE f."runId" = $1 AND f.kind = 'flag' ORDER BY f."createdAt" ASC`,
        [run.id],
      ) as Promise<Array<Record<string, any>>>,
      this.reviews.commentsForRun(run.id, viewer.userId),
      this.reviews.earlierComments(run.id, viewer.userId).catch(() => []),
      meta?.learnerId
        ? (this.dataSource.query(
            `SELECT m."senderId", m.content, m."createdAt"
                 FROM scenario_session_chat_messages m
                 JOIN scenario_session_chats c ON c.id = m."chatId"
                WHERE c."scenarioSessionId" = $1 AND c."userId" = $2
                ORDER BY m."createdAt" ASC`,
            [run.scenarioSessionId, meta.learnerId],
          ) as Promise<Array<Record<string, any>>>)
        : Promise.resolve([] as Array<Record<string, any>>),
      viewer.can.score
        ? this.scoringSample(viewer.userId)
        : Promise.resolve({
            inSample: new Set<string>(),
            ratedByMe: new Set<string>(),
          }),
      this.queueIds(viewer),
      this.settings.get(),
    ]);
    const cards = run.cards as DebriefCards | null;
    const ws = run.workspace ?? {};
    const cardTurns = (section: string | null): number[] => {
      if (!section || !cards) return [];
      const c = cardAt(cards as unknown as Record<string, any>, section);
      const t = Number(c?.turn_index);
      return Number.isFinite(t) ? [t] : [];
    };
    const now = Date.now();
    const flags = flagRows.map((r) => ({
      id: r.id,
      section: r.section ?? null,
      reason: r.reason ?? null,
      note: r.note ?? null,
      urgent: !!r.urgent,
      status: r.status,
      createdAt: iso(r.createdAt),
      // An urgent flag is never held back by the undo window (PRD §6.6).
      inUndoWindow:
        r.status === 'open' &&
        !r.urgent &&
        now - new Date(r.updatedAt).getTime() < FLAG_UNDO_MS,
      resolutionNote: r.resolutionNote ?? null,
      resolvedAt: iso(r.resolvedAt),
      resolvedBy: r.resolvedBy
        ? { id: Number(r.resolvedBy), name: r.resolvedByName ?? null }
        : null,
      cardText:
        r.section === ASK_ALLY_SECTION ? null : sectionText(cards, r.section),
      card:
        r.section === ASK_ALLY_SECTION
          ? null
          : correctableFields(cards, r.section),
      turns: cardTurns(r.section),
      canDecide:
        viewer.can.flagDecision &&
        ['open', 'escalated'].includes(r.status) &&
        canDecideFlag(viewer, r.status),
    }));
    const riskCueTurns = transcript
      .filter((t) => t.riskCue)
      .map((t) => t.turnIndex);
    const distressTurns = (
      (ws.safety?.learner_distress ?? []) as Array<{ turn_index?: unknown }>
    )
      .map((d) => Number(d?.turn_index))
      .filter((n) => Number.isInteger(n) && n > 0);
    const reasons = heldReasons(run);
    const judge = ws.judge as
      | {
          overall: number | null;
          hardFails?: Array<{ code: string; evidence?: string }>;
          dimensions?: Array<{ dimension: string; score: number }>;
        }
      | undefined;
    const judgeBelowBar =
      !!judge &&
      ((judge.overall ?? 10) < DEBRIEF_SEED_BUNDLE.settings.passScore ||
        (judge.hardFails ?? []).length > 0);
    const myVerdict = await this.dataSource.query(
      `SELECT verdict, "hardFails", "updatedAt" FROM debrief_reviews WHERE "runId" = $1 AND "reviewerId" = $2`,
      [run.id, viewer.userId],
    );
    // A clinical advisor alone gives their verdict before seeing the judge's (spec Q3).
    const judgeHidden =
      !viewer.roles.allyTeam && !viewer.roles.owner && !myVerdict.length;
    const userName = async (id: unknown) => {
      if (!id) return null;
      const [u] = await this.dataSource.query(
        `SELECT name FROM users WHERE id = $1`,
        [Number(id)],
      );
      return u?.name ?? null;
    };
    const escalation = ws.escalation
      ? {
          at: ws.escalation.at as string,
          note: (ws.escalation.note as string | null) ?? null,
          by: {
            id: Number(ws.escalation.by),
            name: await userName(ws.escalation.by),
          },
        }
      : null;
    const pending = pendingActions(
      {
        runMode: run.mode,
        status: run.status,
        reviewed: !!ws.review,
        createdAt: run.createdAt.toISOString(),
        learnerDistress: run.learnerDistress,
        judgeBelowBar,
        riskCueTurns,
        distressTurns,
        heldReasonTurns: [
          ...new Set([...reasons.flatMap((r) => r.turns), ...riskCueTurns]),
        ].sort((a, b) => a - b),
        escalation: escalation
          ? { at: escalation.at, note: escalation.note, by: escalation.by.name }
          : null,
        slaHours: ownerSettings.flagReviewSlaHours,
        flags: flags.map((f) => ({
          id: f.id,
          section: f.section,
          status: f.status,
          urgent: f.urgent,
          reason: f.reason,
          note: f.note,
          since: f.createdAt!,
          inUndoWindow: f.inUndoWindow,
          cardTurns: f.turns,
        })),
      },
      viewer,
    );
    const versions = ((ws.versions ?? []) as Array<Record<string, any>>).map(
      (v, i) => ({
        version: Number(v.version ?? i + 2),
        at: v.at,
        by: Number(v.by),
        section: v.section,
        fields: v.fields ?? null,
        note: v.note ?? null,
        flagId: v.flagId ?? null,
        before: v.before ?? null,
      }),
    );
    const decorated = (await this.feedback.decorate(
      {
        state: 'ready',
        runId: run.id,
        cards: run.cards as any,
        language: run.language,
      } as any,
      Number(meta?.learnerId ?? 0),
    )) as { corrections?: unknown[] };
    const inSample = sample.inSample.has(run.scenarioSessionId);
    const pos = queue.indexOf(run.id);
    const reviewedSet = !!ws.review;
    const held = ['needs_person', 'below_bar', 'failed'].includes(run.status);
    return {
      run: {
        id: run.id,
        sessionId: run.scenarioSessionId,
        mode: run.mode,
        status: run.status,
        skipReason: run.skipReason ?? null,
        language: run.language ?? null,
        languageSource: ws.languageSource ?? null,
        recipe: run.recipeKey ?? null,
        releaseVersion: run.releaseVersion ?? null,
        createdAt: run.createdAt.toISOString(),
        hasRiskCue: run.hasRiskCue,
        learnerDistress: run.learnerDistress,
        openedByLearnerAt: ws.openedAt ?? null,
      },
      session: {
        id: run.scenarioSessionId,
        scenario: {
          id: meta?.scenarioId ?? null,
          title: meta?.scenarioTitle ?? null,
        },
        learner: {
          id: meta?.learnerId != null ? Number(meta.learnerId) : null,
          name: meta?.learnerName ?? null,
          level: meta?.learnerLevel ?? null,
        },
        tenantId: run.tenantId ?? null,
        tenantName: meta?.tenantName ?? null,
        startedAt: iso(meta?.startedAt),
        endedAt: iso(meta?.endedAt),
        turns: transcript.length,
      },
      transcript,
      cards: run.cards ?? null,
      cardVersion: versions.length + 1,
      versions,
      corrections: decorated.corrections ?? [],
      flags,
      askAlly: this.askAlly(thread, ws, flags),
      learnerDistress: {
        present:
          run.learnerDistress ||
          flags.some(
            (f) => f.section === ASK_ALLY_SECTION && f.status !== 'withdrawn',
          ),
        inSession: run.learnerDistress,
        inAskAlly: flags.some(
          (f) => f.section === ASK_ALLY_SECTION && f.status !== 'withdrawn',
        ),
        riskCueTurns,
        distressTurns,
      },
      skillEstimate: {
        progress: (ws.progress?.items ?? []) as unknown[],
        skillWords: ((cards as any)?.skill_words ?? []) as unknown[],
        learnerLevel: meta?.learnerLevel ?? null,
        pastSessions: Array.isArray(ws.history?.sessions)
          ? ws.history.sessions.length
          : null,
      },
      howItWasMade: {
        recipe: run.recipeKey ?? null,
        releaseVersion: run.releaseVersion ?? null,
        fallbackRung: run.fallbackRung,
        revisionRounds: run.revisionRounds,
        estimatedCostUsd: num(run.estimatedCostUsd, 4),
        actualCostUsd: num(run.actualCostUsd, 4),
        ceilingUsd: num(run.ceilingUsd, 4),
        seconds:
          run.finishedAt && run.startedAt
            ? Math.round(
                (new Date(run.finishedAt).getTime() -
                  new Date(run.startedAt).getTime()) /
                  1000,
              )
            : null,
        steps: await this.withGuidanceCodes(
          run.steps ?? [],
          Array.isArray(ws.passages) ? (ws.passages as string[]) : [],
        ),
        checkFailures: run.checkFailures ?? [],
        error: run.error ?? null,
      },
      judge: judgeHidden
        ? { hidden: true }
        : {
            hidden: false,
            overall: judge?.overall ?? null,
            belowBar: judgeBelowBar,
            hardFails: judge?.hardFails ?? [],
            dimensions: judge?.dimensions ?? [],
            evaluatorOverall: num(run.evaluatorOverall),
            evaluatorHardFails: run.evaluatorHardFails ?? [],
            // "Why the judge held it" (today's Review tab).
            reasons,
          },
      review: ws.review ?? null,
      escalation,
      comments,
      // Comments on this learner's earlier debriefs of the same scenario (spec C5).
      earlierComments,
      verdict: myVerdict.length
        ? {
            verdict: myVerdict[0].verdict,
            hardFails: myVerdict[0].hardFails ?? [],
            updatedAt: iso(myVerdict[0].updatedAt),
          }
        : null,
      // The κ gate's yes/no questions under the verdict, pre-filled (who gives verdicts).
      agreement: viewer.can.verdict
        ? {
            inSample: await this.agreement.inSample(run.id),
            questions: await this.reviews.agreementQuestions(
              run,
              viewer.userId,
            ),
          }
        : null,
      scoring: {
        inMyScoringSample: inSample,
        scoredByMe: sample.ratedByMe.has(run.scenarioSessionId),
      },
      queue: {
        position: pos >= 0 ? pos + 1 : null,
        total: queue.length,
        previousRunId: pos > 0 ? queue[pos - 1] : null,
        nextRunId: pos >= 0 ? (queue[pos + 1] ?? null) : (queue[0] ?? null),
      },
      pendingActions: pending,
      viewer: this.viewerPayload(viewer),
      can: {
        comment: viewer.can.comment,
        decideFlags: flags.some((f) => f.canDecide),
        publish:
          viewer.can.heldDebrief &&
          run.mode === 'live' &&
          !reviewedSet &&
          ['needs_person', 'below_bar', 'failed'].includes(run.status) &&
          !!run.cards,
        showTodaysDebrief:
          viewer.can.heldDebrief && run.mode === 'live' && !reviewedSet,
        looksFine:
          viewer.can.heldDebrief &&
          run.mode === 'live' &&
          !reviewedSet &&
          (held || judgeBelowBar || run.learnerDistress),
        correct:
          viewer.can.heldDebrief &&
          run.mode === 'live' &&
          ['published', 'below_bar'].includes(run.status) &&
          !!run.cards,
        escalate: viewer.can.escalate && run.mode === 'live' && !ws.escalation,
        verdict: viewer.can.verdict && !!run.cards && run.mode !== 'replay',
        score: viewer.roles.clinicalAdvisor || (viewer.can.score && inSample),
        runAgain: viewer.can.releases,
      },
    };
  }

  /** Ask Ally: each question with its reply, whether the checks passed or replaced it, and its cost. */
  private askAlly(
    thread: Array<Record<string, any>>,
    ws: Record<string, any>,
    flags: Array<{
      id: string;
      section: string | null;
      status: string;
      createdAt: string | null;
    }>,
  ) {
    const traces = (ws.replyTraces ?? []) as Array<Record<string, any>>;
    const replaced = (ws.replacedReplies ?? []) as Array<Record<string, any>>;
    const meta = (ws.replyMeta ?? []) as Array<Record<string, any>>;
    const exchanges: Array<{
      question: string;
      askedAt: string;
      reply: string | null;
      repliedAt: string | null;
      check: 'passed' | 'replaced' | 'no_reply';
      replacedReply: { reply: string; fails: string[] } | null;
      section: string | null;
      firstWordsMs: number | null;
      costUsd: number | null;
      model: string | null;
      tools: unknown[];
    }> = [];
    let replyIdx = 0;
    let replacedIdx = 0;
    for (let i = 0; i < thread.length; i++) {
      const m = thread[i];
      if (Number(m.senderId) === -1) continue;
      const next = thread[i + 1];
      const reply = next && Number(next.senderId) === -1 ? next : null;
      const wasReplaced =
        !!reply && String(reply.content ?? '').startsWith(CHECK_FALLBACK);
      const trace = reply ? (traces[replyIdx++] ?? null) : null;
      const rep = wasReplaced ? (replaced[replacedIdx++] ?? null) : null;
      // The reply's own record: the one finished closest after it was saved.
      const rm = reply
        ? (meta.find(
            (x) =>
              Math.abs(
                new Date(x.at).getTime() - new Date(reply.createdAt).getTime(),
              ) < 10_000,
          ) ?? null)
        : null;
      exchanges.push({
        question: String(m.content ?? ''),
        askedAt: new Date(m.createdAt).toISOString(),
        reply: reply ? String(reply.content ?? '') : null,
        repliedAt: reply ? new Date(reply.createdAt).toISOString() : null,
        check: !reply ? 'no_reply' : wasReplaced ? 'replaced' : 'passed',
        replacedReply: rep
          ? { reply: String(rep.reply ?? ''), fails: rep.fails ?? [] }
          : null,
        section: (rm?.section as string | null) ?? null,
        firstWordsMs: rm?.firstWordsMs != null ? Number(rm.firstWordsMs) : null,
        costUsd: trace ? num(trace.costUsd, 4) : null,
        model: trace?.model ?? null,
        tools: trace?.tools ?? [],
      });
    }
    return {
      exchanges,
      totalCostUsd: num(
        traces.reduce((n, t) => n + Number(t.costUsd ?? 0), 0),
        4,
      ),
      distressItems: flags.filter((f) => f.section === ASK_ALLY_SECTION),
    };
  }

  // --- Attention ------------------------------------------------------------------------

  /**
   * The banners and counts on Debriefs home and the PM agent (notes,
   * "Attention"), only for roles that can act: red = act now, yellow = act
   * soon. Each links to the item to read; nothing acts from a banner.
   */
  async attention(viewer: DebriefViewer) {
    const team = viewer.roles.allyTeam || viewer.roles.owner;
    const banners: Array<{
      kind: string;
      level: 'red' | 'yellow';
      count?: number;
      oldestSince?: string | null;
      overdue?: boolean;
      message: string;
      link: {
        page: 'session' | 'home' | 'pm_agent' | 'settings' | 'analytics';
        runId?: string;
        ideaId?: string;
        category?: string;
      };
    }> = [];
    const s = await this.settings.get();
    const slaMs = s.flagReviewSlaHours * 3_600_000;
    const params: unknown[] = [];
    const base = this.baseSql(
      { category: 'needs', mode: 'live', limit: 500, offset: 0 },
      params,
    );
    const rows: Array<Record<string, any>> = await this.dataSource.query(
      `${base}
       SELECT id, rank, escalated, COALESCE(flag_since, "createdAt") AS since, status
         FROM ranked WHERE rank < 3 OR escalated
        ORDER BY rank ASC, COALESCE(flag_since, "createdAt") ASC`,
      params,
    );
    const urgent = rows.filter((r) => Number(r.rank) === 0);
    const held = rows.filter(
      (r) =>
        Number(r.rank) === 2 && ['needs_person', 'failed'].includes(r.status),
    );
    const escalated = rows.filter((r) => r.escalated);
    const overdue = (since: unknown) =>
      Date.now() - new Date(since as string).getTime() > slaMs;
    if (team && urgent.length) {
      banners.push({
        kind: 'urgent',
        level: 'red',
        count: urgent.length,
        oldestSince: iso(urgent[0].since),
        overdue: overdue(urgent[0].since),
        message: `${urgent.length} urgent: a flag on an important moment or a learner in distress.`,
        link: { page: 'session', runId: urgent[0].id },
      });
    }
    if (team && held.length) {
      const late = held.filter((r) => overdue(r.since));
      banners.push({
        kind: 'held',
        level: late.length ? 'red' : 'yellow',
        count: held.length,
        oldestSince: iso(held[0].since),
        overdue: late.length > 0,
        message: `${held.length} debrief(s) held; the learner sees “on its way”.`,
        link: { page: 'session', runId: held[0].id },
      });
    }
    if (viewer.roles.receivesEscalations && escalated.length) {
      banners.push({
        kind: 'escalated',
        level: 'red',
        count: escalated.length,
        oldestSince: iso(escalated[0].since),
        message: `${escalated.length} escalated to you.`,
        link: { page: 'home', category: 'escalated' },
      });
    }

    // Canaries reverted on their own in the last 7 days.
    const reverted: Array<Record<string, any>> = await this.dataSource.query(
      `SELECT id, text, evidence->'canary' AS canary FROM agent_lessons
        WHERE "agentKey" = 'debrief' AND evidence->'canary'->>'status' = 'reverted'
          AND COALESCE((evidence->'canary'->>'checkedAt')::timestamptz, "updatedAt") >= now() - interval '7 days'
        ORDER BY "updatedAt" DESC`,
    );
    if (team && reverted.length) {
      banners.push({
        kind: 'canary_reverted',
        level: 'red',
        count: reverted.length,
        message: `Canary reverted on its own: ${reverted[0].text}${reverted[0].canary?.reason ? ` (${reverted[0].canary.reason})` : ''}.`,
        link: { page: 'pm_agent', ideaId: reverted[0].id },
      });
    }

    // Approvals within 3 days of their 14-day expiry; "needs you" counts.
    const ideas: Array<Record<string, any>> = await this.dataSource.query(
      `SELECT id, status, text, change, evidence, "createdAt" FROM agent_lessons
        WHERE "agentKey" = 'debrief' AND status IN ('proposed','approved')`,
    );
    let needsYouTeam = 0;
    let needsYouPinned = 0;
    const expiring: Array<{
      id: string;
      text: string;
      days: number;
      pinned: boolean;
    }> = [];
    for (const i of ideas) {
      const a = approvalState(i as any);
      if (!a || a.expired) continue;
      const pinned = a.wait === 'pinned_rule';
      if (pinned) needsYouPinned++;
      else needsYouTeam++;
      if (a.expiringSoon) {
        expiring.push({
          id: i.id,
          text: i.text,
          days: a.expiresInDays,
          pinned,
        });
      }
    }
    const mayApprove = (pinned: boolean) =>
      pinned ? viewer.can.approvePinnedRule : viewer.can.pmAgent;
    const mine = expiring.filter((e) => mayApprove(e.pinned));
    if (mine.length) {
      banners.push({
        kind: 'approval_expiring',
        level: 'yellow',
        count: mine.length,
        message: `${mine.length} approval(s) expire within 3 days with no decision.`,
        link: { page: 'pm_agent', ideaId: mine[0].id },
      });
    }

    // The agent itself: switched off, the monthly cap, providers failing, languages not recorded.
    const overview = await this.console.overview(1);
    if (team && this.config.debriefAgentMode === 'off') {
      banners.push({
        kind: 'agent_off',
        level: 'red',
        message: 'The Debrief agent is switched off.',
        link: { page: 'settings' },
      });
    }
    const spent = Number(overview.budget.monthSpentUsd ?? 0);
    const cap = Number(overview.budget.monthlyCapUsd ?? 0);
    if ((team || viewer.roles.owner) && cap > 0 && spent / cap >= 0.8) {
      banners.push({
        kind: 'cap',
        level: spent >= cap ? 'red' : 'yellow',
        message: `$${spent.toFixed(2)} of the $${cap.toFixed(2)} monthly cap spent (${Math.round((spent / cap) * 100)}%).`,
        link: { page: 'settings' },
      });
    }
    // A Skills Store or code release waiting because it would undo a
    // promoted change.
    if (team && this.releasesView) {
      for (const w of await this.releasesView
        .waitingReleases()
        .catch(() => [])) {
        const c = w.conflicts[0];
        banners.push({
          kind: 'release_waiting',
          level: 'red',
          count: w.conflicts.length,
          message: c
            ? `${w.source.kind === 'code' ? 'Code release' : 'Skills Store release'} v${w.version} is waiting: it would undo ${c.changedBy?.label ?? 'a promoted change'} on ${c.what}${w.conflicts.length > 1 ? ` (and ${w.conflicts.length - 1} more)` : ''}.`
            : `Release v${w.version} is waiting: it does not pass the release checks.`,
          link: { page: 'pm_agent', releaseId: w.id } as any,
        });
      }
    }
    const failing = await this.providersFailing();
    if (team && failing.length) {
      banners.push({
        kind: 'provider_down',
        level: 'red',
        message: `A model provider is failing: ${failing.map((f) => `${f.provider} (${f.failed}/${f.total} steps in the last hour)`).join(', ')}.`,
        link: { page: 'analytics' },
      });
    }
    if (team && overview.languageIncidents.length) {
      banners.push({
        kind: 'language_not_recorded',
        level: 'yellow',
        count: overview.languageIncidents.length,
        message: `${overview.languageIncidents.map((l) => l.tenantName ?? l.tenantId).join(', ')}: sessions not recording a language.`,
        link: { page: 'home' },
      });
    }
    return {
      banners,
      counts: {
        urgent: team ? urgent.length : null,
        oldestUrgentSince: team && urgent.length ? iso(urgent[0].since) : null,
        escalatedToMe: viewer.roles.receivesEscalations
          ? escalated.length
          : null,
        // The "Needs you" count on the PM agent button, for this role.
        pmAgentNeedsYou:
          (viewer.can.pmAgent ? needsYouTeam : 0) +
          (viewer.can.approvePinnedRule ? needsYouPinned : 0),
      },
      viewer: this.viewerPayload(viewer),
    };
  }

  /** Providers whose steps mostly failed in the last hour (at least 3 attempts). */
  private async providersFailing(): Promise<
    Array<{ provider: string; failed: number; total: number }>
  > {
    const rows: Array<{ model: string | null; failed: number; total: number }> =
      await this.dataSource.query(
        `SELECT s->>'model' AS model,
                count(*) FILTER (WHERE s->>'status' = 'failed')::int AS failed,
                count(*) FILTER (WHERE s->>'status' IN ('done','failed'))::int AS total
           FROM debrief_runs r, jsonb_array_elements(COALESCE(r.steps, '[]'::jsonb)) s
          WHERE r."createdAt" >= now() - interval '1 hour' AND s->>'model' IS NOT NULL
          GROUP BY 1`,
      );
    const byProvider = new Map<string, { failed: number; total: number }>();
    for (const r of rows) {
      const m = String(r.model ?? '');
      const provider = m.startsWith('gemini')
        ? 'gemini'
        : m.startsWith('gpt') || m.startsWith('o')
          ? 'openai'
          : m.startsWith('claude')
            ? 'anthropic'
            : m.split(/[-/]/)[0] || 'other';
      const p = byProvider.get(provider) ?? { failed: 0, total: 0 };
      p.failed += Number(r.failed);
      p.total += Number(r.total);
      byProvider.set(provider, p);
    }
    return [...byProvider.entries()]
      .filter(([, p]) => p.total >= 3 && p.failed / p.total > 0.5)
      .map(([provider, p]) => ({ provider, ...p }));
  }

  // --- Analytics › Debriefs --------------------------------------------------------------

  /**
   * The tiles that moved from the console, the cost panel and judge
   * agreement (the calibration page's numbers) for Analytics › Debriefs.
   */
  async analytics(days: number) {
    const overview = await this.console.overview(days);
    const tenants = await this.console.tenants();
    const settings = (overview.budget ?? {}) as Record<string, number | null>;
    const [pool] = await this.dataSource.query(
      `SELECT count(*) FILTER (WHERE status <> 'skipped')::int AS sessions,
              COALESCE(sum(COALESCE("actualCostUsd","estimatedCostUsd")), 0)::float AS spent,
              COALESCE(sum(COALESCE("actualCostUsd","estimatedCostUsd"))
                FILTER (WHERE "createdAt" >= now() - interval '7 days'), 0)::float AS last7
         FROM debrief_runs
        WHERE mode IN ('shadow','live') AND "createdAt" >= date_trunc('month', now())`,
    );
    const { bundle } = await this.pmAgent.gaBundle();
    const perSession = bundle.settings.poolPerSessionUsd;
    const d = new Date();
    const daysInMonth = new Date(
      d.getUTCFullYear(),
      d.getUTCMonth() + 1,
      0,
    ).getDate();
    const elapsedDays = Math.max(
      d.getUTCDate() - 1 + d.getUTCHours() / 24,
      1 / 24,
    );
    const spent = Number(pool?.spent ?? 0);
    const perDay = spent / elapsedDays;
    const params: unknown[] = [];
    const base = this.baseSql(
      { category: 'needs', mode: 'live', limit: 1, offset: 0 },
      params,
    );
    const [needs] = await this.dataSource.query(
      `${base} SELECT count(*) FILTER (WHERE rank < 3)::int AS n FROM ranked`,
      params,
    );
    let agreement: Record<string, any> | null = null;
    try {
      agreement = await (await this.calibration()).getAgreement();
    } catch {
      agreement = null;
    }
    return {
      windowDays: days,
      tiles: {
        runs: overview.runs.total,
        judgeMean: overview.judge.mean,
        meetsTheBar: overview.judge.passRate,
        needsAPerson: Number(needs?.n ?? 0),
        costP50Usd: overview.costUsd.p50,
        costP90Usd: overview.costUsd.p90,
        spentThisMonthUsd: overview.budget.monthSpentUsd,
      },
      runs: overview.runs,
      seconds: overview.seconds,
      cost: {
        perOrg: tenants
          .filter((t) => t.monthRuns > 0 || t.monthSpentUsd > 0)
          .map((t) => ({
            tenantId: t.id,
            tenantName: t.name,
            live: t.live,
            monthSpentUsd: t.monthSpentUsd,
            monthRuns: t.monthRuns,
          })),
        pool: {
          sessionsThisMonth: Number(pool?.sessions ?? 0),
          addedUsd: num(Number(pool?.sessions ?? 0) * perSession),
          spentUsd: num(spent),
          balanceUsd: num(Number(pool?.sessions ?? 0) * perSession - spent),
          monthlyCapUsd: settings.monthlyCapUsd ?? null,
          capLeftUsd: num(Number(settings.monthlyCapUsd ?? 0) - spent),
          runCeilingUsd: settings.runCeilingUsd ?? null,
        },
        learning: {
          spentUsd: settings.learningSpentUsd ?? null,
          budgetUsd: settings.learningBudgetUsd ?? null,
          balanceUsd: num(
            Number(settings.learningBudgetUsd ?? 0) -
              Number(settings.learningSpentUsd ?? 0),
          ),
        },
        burnRate: {
          perDayUsd: num(perDay, 4),
          last7DaysUsd: num(pool?.last7),
          projectedMonthUsd: num(perDay * daysInMonth),
        },
      },
      judgeAgreement: agreement
        ? {
            gate: agreement.gate,
            target: agreement.target,
            debriefsRated: agreement.coverage?.debriefs ?? 0,
            ratings: agreement.coverage?.ratings ?? 0,
            peopleRating: agreement.coverage?.raters ?? 0,
            // κ per dimension and agreement by rubric part (within one point).
            dimensions: Object.entries(
              (agreement.judgeVsHuman?.dimensions ?? {}) as Record<string, any>,
            ).map(([dimension, a]) => ({
              dimension,
              kappa: a.weightedKappa ?? null,
              withinOnePct: a.withinOnePct ?? null,
              meanDifference: a.meanDifference ?? null,
              pairs: a.pairs ?? 0,
            })),
            hardFails: Object.entries(
              (agreement.judgeVsHuman?.hardFails ?? {}) as Record<string, any>,
            ).map(([code, a]) => ({
              code,
              kappa: a.kappa ?? null,
              pairs: a.pairs ?? 0,
            })),
            humanVsHuman: agreement.humanVsHuman ?? null,
            expertVerdicts: agreement.expertVerdicts ?? null,
          }
        : null,
    };
  }

  // --- PM agent and pinned rules -------------------------------------------------------

  /** One idea as the PM agent page shows it: its approval clock, questions and what the viewer may do. */
  ideaView(idea: Record<string, any>, viewer: DebriefViewer) {
    const a = approvalState(idea as any);
    const kind = changeKindOf(idea.change);
    const pinned = idea.change?.ideaKind === 'pinned_rule';
    const mayDecide = pinned
      ? viewer.can.approvePinnedRule
      : viewer.can.pmAgent;
    const expired = !!idea.evidence?.expiry;
    const st = ideaState(idea as any);
    const budgetOnly = !!idea.change?.budgetOnly;
    return {
      ...idea,
      ...st,
      kind: idea.change?.ideaKind ?? null,
      changeKind: kind,
      approval: a,
      expired,
      notTakenForward: idea.status === 'rejected',
      notTakenForwardReason: expired
        ? 'no_decision'
        : idea.status === 'rejected'
          ? 'rejected'
          : null,
      questions: (idea.evidence?.questions ?? []) as unknown[],
      can: {
        approve:
          !!a &&
          !a.expired &&
          !['start_quick_test', 'start_gate', 'start_trial'].includes(a.wait) &&
          (budgetOnly ? viewer.can.ownerSettings : mayDecide),
        reject: !['active', 'rejected'].includes(idea.status) && mayDecide,
        tryIt:
          viewer.can.pmAgent &&
          st.state === 'open' &&
          !budgetOnly &&
          ['prompt_edit', 'setting', 'release'].includes(idea.change?.ideaKind),
        editDraft:
          viewer.can.pmAgent &&
          idea.change?.ideaKind === 'release' &&
          idea.status === 'proposed' &&
          !idea.evidence?.screen,
        askQuestion:
          viewer.can.pmAgent && !['rejected', 'retired'].includes(idea.status),
        startStep:
          viewer.can.pmAgent &&
          (a?.wait === 'start_gate' || a?.wait === 'start_trial'),
      },
    };
  }

  /**
   * Settings › Pinned rules: the current version of each (safety rules, the
   * rubric, the judge's instructions), the version the live release pins,
   * and who signed it and when — the latest pinned-rule sign-off in the
   * console, else who wrote the version.
   */
  async pinnedRules() {
    const { bundle } = await this.pmAgent.gaBundle();
    const out = [];
    for (const p of PINNED_RULE_PROMPTS) {
      const pinnedVersion =
        (bundle.prompts as Record<string, number | null>)[p.code] ?? null;
      const [v] = await this.dataSource.query(
        `SELECT pv.version, pv."createdAt", pv."createdBy", pv.note, u.name AS "createdByName",
                p."currentVersion"
           FROM prompts p
           JOIN prompts_versions pv ON pv."promptId" = p.id
           LEFT JOIN users u ON u.id = pv."createdBy"
          WHERE p."promptCode" = $1 AND pv.version = COALESCE($2::int, p."currentVersion")
          LIMIT 1`,
        [p.code, pinnedVersion],
      );
      const [sign] = await this.dataSource.query(
        `SELECT l.id, l.evidence->'signoff' AS signoff, u.name
           FROM agent_lessons l
           LEFT JOIN users u ON u.id = (l.evidence->'signoff'->>'by')::int
          WHERE l."agentKey" = 'debrief' AND l.change->>'ideaKind' = 'pinned_rule'
            AND l.change->>'promptCode' = $1 AND l.evidence ? 'signoff'
            AND (l.evidence->'signoff'->>'promptVersion')::int = $2
          ORDER BY l."decidedAt" DESC NULLS LAST LIMIT 1`,
        [p.code, v?.version ?? -1],
      );
      out.push({
        code: p.code,
        label: p.label,
        version: v?.version ?? null,
        pinnedByRelease: pinnedVersion != null,
        inBundle: p.code in bundle.prompts,
        signedBy: sign
          ? { id: Number(sign.signoff.by), name: sign.name ?? null }
          : null,
        signedAt: sign ? sign.signoff.at : null,
        ideaId: sign?.id ?? null,
        writtenBy: v?.createdBy
          ? { id: Number(v.createdBy), name: v.createdByName ?? null }
          : null,
        writtenAt: iso(v?.createdAt),
        note: v?.note ?? null,
      });
    }
    const proposals = await this.dataSource.query(
      `SELECT id, text, change, evidence, status, "createdAt" FROM agent_lessons
        WHERE "agentKey" = 'debrief' AND change->>'ideaKind' = 'pinned_rule'
          AND status = 'proposed' ORDER BY "createdAt" ASC`,
    );
    return { rules: out, proposals };
  }

  /** The autonomy view with what this viewer may change. */
  async autonomyView(viewer: DebriefViewer) {
    return {
      ...(await this.autonomy.view()),
      can: { change: viewer.can.ownerSettings },
    };
  }
}
