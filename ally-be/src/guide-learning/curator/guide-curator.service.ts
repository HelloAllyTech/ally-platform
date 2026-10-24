import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { LlmTask } from 'src/learn/enum/llm-task.enum';
import { LoggerService } from 'src/logger/logger.service';
import { AgentLesson } from 'src/llm-agent/entity/agent-lesson.entity';
import { AgentRelease } from 'src/llm-agent/entity/agent-release.entity';
import {
  AgentReleaseAuthorKind,
  AgentReleaseStatus,
} from 'src/llm-agent/harness/enum/harness.enum';
import {
  AgentLessonAuditAction,
  AgentLessonScope,
  AgentLessonStatus,
} from 'src/llm-agent/harness/enum/learning.enum';
import { AgentReleaseService } from 'src/llm-agent/harness/release/agent-release.service';
import { flattenPolicy } from 'src/llm-agent/harness/config/policy-schema';
import { scheduledTaskRegistry } from 'src/scheduler/registry/scheduled-task.registry';
import { GUIDE_AI_TASKS } from 'src/guide/constants/guide-ai-tasks.constants';
import {
  ALLY_GUIDE_AGENT_KEY,
  GuideReleaseBundle,
  evaluatorPolicy,
  loopPolicy,
} from 'src/guide/release/guide-release.bundle';
import { GUIDE_POLICY_SCHEMA } from 'src/guide/release/policy.schema';
import { GuideModelService } from 'src/guide/runtime/guide-model.service';
import { redactText } from 'src/guide/safety/redaction';
import {
  CURATOR_LOOKBACK_DAYS,
  CURATOR_MAX_CLUSTERS,
  CURATOR_MAX_TOKENS,
  CURATOR_TRANSCRIPT_LIMIT,
  GUIDE_LEARNING_COST_KEY,
  JUDGE_TIMEOUT_MS,
} from '../constants/guide-learning.constants';
import {
  BudgetSpentError,
  GuideJudgeService,
} from '../evaluator/guide-judge.service';
import { RUBRIC_CRITERIA } from '../evaluator/rubric';
import {
  CURATOR_OUTPUT_SCHEMA,
  CURATOR_PROMPT_VERSION,
  CURATOR_SYSTEM_PROMPT,
  buildCuratorMessage,
} from '../prompts/curator.prompt';
import { GuideReviewService } from '../review/guide-review.service';
import { CopiedTextIndex } from './copied-text';
import {
  EvidenceCluster,
  EvidenceRow,
  buildClusters,
  evidenceSuffices,
} from './evidence';
import {
  CURATOR_EDITABLE_ROLES,
  CURATOR_PROTECTED_GROUPS,
  ChangeVerdict,
  ProposedChange,
  buildCandidateBundle,
  changeHash,
  countPlaybook,
  currentPlaybook,
  vetChanges,
} from './guardrails';
import { GuideLearningAuditService } from './guide-learning-audit.service';

export const CURATOR_TASK = 'ally-guide-curator';

/** Releases still on their way through the pipeline. */
export const IN_FLIGHT_STATUSES = [
  AgentReleaseStatus.DRAFT,
  AgentReleaseStatus.EVALUATING,
  AgentReleaseStatus.CANDIDATE,
  AgentReleaseStatus.SHADOW,
  AgentReleaseStatus.CANARY,
];

export interface CuratorReport {
  ranAt: string;
  skipped: string | null;
  clustersRead: number;
  clustersOffered: number;
  proposed: number;
  accepted: number;
  quarantined: number;
  blocked: number;
  byReason: Record<string, number>;
  releaseId: string | null;
  releaseVersion: number | null;
  costUsd: number;
}

/** Parse the curator's structured output into changes. Tolerant of fences. */
export function parseCuratorOutput(text: string): ProposedChange[] {
  const raw = JSON.parse(text.trim().replace(/^```(?:json)?|```$/g, ''));
  const list = (value: unknown): Array<Record<string, any>> =>
    Array.isArray(value) ? (value as Array<Record<string, any>>) : [];
  const str = (value: unknown, max: number) =>
    typeof value === 'string' ? value.slice(0, max) : '';
  return [
    ...list(raw?.lessons).map(
      (l): ProposedChange => ({
        kind: 'lesson',
        clusterId: str(l.clusterId, 200),
        text: str(l.text, 600),
        rationale: str(l.rationale, 600),
      }),
    ),
    ...list(raw?.policyTweaks).map(
      (t): ProposedChange => ({
        kind: 'policy',
        clusterId: str(t.clusterId, 200),
        text: `Set ${str(t.key, 120)} to ${String(t.value)}`,
        rationale: str(t.rationale, 600),
        policy: {
          key: str(t.key, 120),
          value: typeof t.value === 'number' ? t.value : Number.NaN,
        },
      }),
    ),
    ...list(raw?.promptTweaks).map(
      (t): ProposedChange => ({
        kind: 'prompt',
        clusterId: str(t.clusterId, 200),
        text: `Edit the ${str(t.role, 40)} instructions`,
        rationale: str(t.rationale, 600),
        prompt: {
          role: str(t.role, 40),
          find: str(t.find, 2000),
          replace: str(t.replace, 2000),
        },
      }),
    ),
  ].filter((c) => c.clusterId);
}

/**
 * The curator (plans/ally-guide/plan.md §7.13 loop 2): once a day it reads
 * the evidence the loop trusts, asks one model for at most five small
 * changes, runs every one through the guardrails in code, and writes what
 * survives as a curator DRAFT release carrying a new playbook. Blocked and
 * quarantined changes are kept, with the reason, for a person to read.
 *
 * One curator release in the pipeline at a time: tomorrow's proposal waits
 * until today's is decided, so each canary measures one set of changes.
 */
@Injectable()
export class GuideCuratorService implements OnModuleInit {
  private readonly logger = LoggerService.getInstance(GuideCuratorService.name);

  constructor(
    @InjectRepository(AgentLesson)
    private readonly lessons: Repository<AgentLesson>,
    private readonly dataSource: DataSource,
    private readonly releases: AgentReleaseService,
    private readonly models: GuideModelService,
    private readonly judges: GuideJudgeService,
    private readonly reviews: GuideReviewService,
    private readonly audit: GuideLearningAuditService,
  ) {}

  onModuleInit(): void {
    scheduledTaskRegistry.register('daily', CURATOR_TASK, () =>
      this.run({ userId: null }).then(() => undefined),
    );
  }

  /** The curator release still in the pipeline, if any. */
  async inFlight(): Promise<AgentRelease | null> {
    return this.dataSource.getRepository(AgentRelease).findOne({
      where: {
        agentKey: ALLY_GUIDE_AGENT_KEY,
        authorKind: AgentReleaseAuthorKind.CURATOR,
        status: In(IN_FLIGHT_STATUSES),
      },
      order: { version: 'DESC' },
    });
  }

  /**
   * Failures the loop trusts, from the last `days`: critic verdicts on
   * κ-trusted criteria, every person's review label, and deterministic
   * check failures (which need no κ: they are code). Counts, ids and
   * judge-written reasons only.
   */
  async evidenceRows(
    trusted: Set<string>,
    days = CURATOR_LOOKBACK_DAYS,
  ): Promise<EvidenceRow[]> {
    const evaluations: Array<{
      id: string;
      turnId: string;
      tenantId: string | null;
      trackId: string | null;
      userId: number | null;
      visitorId: string | null;
      critic: {
        criteria?: Record<string, { verdict: string; reason?: string }>;
      } | null;
      deterministic: Array<{
        id: string;
        applicable: boolean;
        passed: boolean;
      }> | null;
    }> = await this.dataSource.query(
      `SELECT e."id", e."turnId", e."tenant_id" AS "tenantId", th."trackId",
              th."userId", th."visitorId", e."critic", e."deterministic"
         FROM "agent_evaluations" e
         JOIN "guide_threads" th ON th."id" = e."threadId"
        WHERE e."agentKey" = $1 AND e."createdAt" >= now() - ($2::int * interval '1 day')`,
      [ALLY_GUIDE_AGENT_KEY, days],
    );
    const reviews: Array<{
      turnId: string;
      evaluationId: string | null;
      tenantId: string | null;
      trackId: string | null;
      userId: number | null;
      visitorId: string | null;
      labels: Record<string, string> | null;
      notes: string | null;
    }> = await this.dataSource.query(
      `SELECT r."turnId", r."evaluationId", r."tenant_id" AS "tenantId", th."trackId",
              th."userId", th."visitorId", r."labels", r."notes"
         FROM "agent_reviews" r
         JOIN "guide_threads" th ON th."id" = r."threadId"
        WHERE r."agentKey" = $1 AND r."status" = 'done' AND r."labels" IS NOT NULL
          AND r."completedAt" >= now() - ($2::int * interval '1 day')`,
      [ALLY_GUIDE_AGENT_KEY, days],
    );
    const learner = (row: {
      userId: number | null;
      visitorId: string | null;
    }) =>
      row.userId
        ? `u:${row.userId}`
        : row.visitorId
          ? `v:${row.visitorId}`
          : null;
    const rows: EvidenceRow[] = [];
    for (const e of evaluations) {
      const base = {
        turnId: e.turnId,
        evaluationId: e.id,
        learner: learner(e),
        tenantId: e.tenantId,
        trackId: e.trackId,
      };
      for (const [id, verdict] of Object.entries(e.critic?.criteria ?? {})) {
        if (verdict?.verdict !== 'fail' || !trusted.has(id)) continue;
        rows.push({
          ...base,
          signal: `criterion:${id}`,
          source: 'critic',
          reason: verdict.reason ? redactText(verdict.reason) : null,
        });
      }
      for (const check of e.deterministic ?? []) {
        if (!check.applicable || check.passed) continue;
        rows.push({
          ...base,
          signal: `check:${check.id}`,
          source: 'check',
          reason: null,
        });
      }
    }
    for (const r of reviews) {
      for (const [id, label] of Object.entries(r.labels ?? {})) {
        if (label !== 'fail') continue;
        rows.push({
          signal: `criterion:${id}`,
          source: 'review',
          turnId: r.turnId,
          evaluationId: r.evaluationId,
          learner: learner(r),
          tenantId: r.tenantId,
          trackId: r.trackId,
          reason: r.notes ? redactText(r.notes).slice(0, 240) : null,
        });
      }
    }
    return rows;
  }

  /** What learners wrote in the last `days`, for the copied-text check. */
  async transcriptCorpus(days = CURATOR_LOOKBACK_DAYS * 2): Promise<string[]> {
    const rows: Array<{ content: string | null }> = await this.dataSource.query(
      `SELECT m."content" FROM "guide_messages" m
        WHERE m."role" = 'learner' AND m."content" IS NOT NULL
          AND m."createdAt" >= now() - ($1::int * interval '1 day')
        ORDER BY m."createdAt" DESC
        LIMIT $2`,
      [days, CURATOR_TRANSCRIPT_LIMIT],
    );
    return rows.map((row) => row.content ?? '').filter(Boolean);
  }

  /** One curator run. Never throws on a model failure: it is audited instead. */
  async run(opts: { userId: number | null }): Promise<CuratorReport> {
    const actorKind =
      opts.userId === null
        ? AgentReleaseAuthorKind.CURATOR
        : AgentReleaseAuthorKind.HUMAN;
    const report: CuratorReport = {
      ranAt: new Date().toISOString(),
      skipped: null,
      clustersRead: 0,
      clustersOffered: 0,
      proposed: 0,
      accepted: 0,
      quarantined: 0,
      blocked: 0,
      byReason: {},
      releaseId: null,
      releaseVersion: null,
      costUsd: 0,
    };
    const finish = async (skipped?: string) => {
      if (skipped) report.skipped = skipped;
      await this.audit.record({
        action: AgentLessonAuditAction.CURATOR_RUN,
        actorKind,
        actorUserId: opts.userId,
        releaseId: report.releaseId,
        detail: { ...report, promptVersion: CURATOR_PROMPT_VERSION },
      });
      this.logger.info(
        `Ally curator: ${report.accepted} accepted, ${report.quarantined} quarantined, ${report.blocked} blocked` +
          (report.skipped ? ` (skipped: ${report.skipped})` : '') +
          (report.releaseVersion ? ` → draft v${report.releaseVersion}` : ''),
      );
      return report;
    };

    await this.syncStatuses();
    const busy = await this.inFlight();
    if (busy) {
      return finish(
        `curator release v${busy.version} is still ${busy.status}; one proposal in the pipeline at a time`,
      );
    }
    const ga = await this.releases.getGa(ALLY_GUIDE_AGENT_KEY);
    if (!ga) return finish('there is no GA release to build on');
    const gaBundle = ga.bundle as unknown as GuideReleaseBundle;
    const policy = loopPolicy(gaBundle.policy);
    const playbook = currentPlaybook(gaBundle);

    const retired = await this.lessons.find({
      where: {
        agentKey: ALLY_GUIDE_AGENT_KEY,
        status: AgentLessonStatus.RETIRED,
        id: In(playbook.map((l) => l.id).filter(isUuid)),
      },
    });
    const retiredIds = new Set(retired.map((l) => l.id));
    const approved = await this.lessons.find({
      where: {
        agentKey: ALLY_GUIDE_AGENT_KEY,
        status: AgentLessonStatus.APPROVED,
      },
      order: { decidedAt: 'ASC' },
    });

    const trusted = await this.reviews.trustedCriteria();
    const clusters = buildClusters(await this.evidenceRows(trusted));
    report.clustersRead = clusters.length;
    const offered = clusters
      .filter((c) => evidenceSuffices(c, policy).ok)
      .slice(0, CURATOR_MAX_CLUSTERS);
    report.clustersOffered = offered.length;

    let proposed: ProposedChange[] = [];
    if (offered.length) {
      try {
        await this.judges.assertBudget(
          evaluatorPolicy(gaBundle.policy).dailyBudgetUsd,
        );
        const { text, usd } = await this.ask(gaBundle, offered, playbook);
        report.costUsd = usd;
        proposed = parseCuratorOutput(text);
      } catch (error) {
        const message =
          error instanceof BudgetSpentError
            ? error.message
            : `the curator call failed: ${error instanceof Error ? error.message : String(error)}`;
        if (!approved.length && !retiredIds.size) return finish(message);
        report.skipped = message;
      }
    }
    const carried: ProposedChange[] = approved.map((lesson) => ({
      kind: 'lesson',
      clusterId: `approved:${lesson.id}`,
      text: lesson.text,
      rationale: lesson.rationale ?? '',
      approved: {
        lessonId: lesson.id,
        scope: lesson.scope,
        tenantId: lesson.tenantId ?? null,
        trackId: lesson.trackId ?? null,
        learners: Number(lesson.evidence?.learners ?? 0),
      },
    }));
    if (!proposed.length && !carried.length && !retiredIds.size) {
      return finish(
        offered.length
          ? 'the curator proposed nothing'
          : 'no evidence cluster meets its scope’s threshold',
      );
    }
    report.proposed = proposed.length;

    const known = await this.lessons.find({
      where: {
        agentKey: ALLY_GUIDE_AGENT_KEY,
        status: In([
          AgentLessonStatus.PROPOSED,
          AgentLessonStatus.ACTIVE,
          AgentLessonStatus.QUARANTINED,
          AgentLessonStatus.APPROVED,
        ]),
      },
      select: { contentHash: true },
    });
    const copied = new CopiedTextIndex(
      await this.transcriptCorpus(),
      policy.copyNgram,
    );
    const verdicts = vetChanges({
      changes: [...carried, ...proposed],
      clusters: new Map(offered.map((c) => [c.id, c])),
      bundle: gaBundle,
      schema: GUIDE_POLICY_SCHEMA,
      copied,
      activeCounts: countPlaybook(
        playbook.filter((l) => !retiredIds.has(l.id)),
      ),
      knownHashes: new Set(known.map((k) => k.contentHash)),
      policy,
    });

    const accepted: Array<{ verdict: ChangeVerdict; lessonId: string }> = [];
    for (const verdict of verdicts) {
      const saved = await this.saveVerdict(verdict, actorKind, opts.userId);
      if (verdict.outcome === 'accept') {
        report.accepted++;
        accepted.push({ verdict, lessonId: saved.id });
      } else if (verdict.outcome === 'quarantine') {
        report.quarantined++;
      } else {
        report.blocked++;
      }
      const reason = verdict.reason ?? 'accepted';
      report.byReason[reason] = (report.byReason[reason] ?? 0) + 1;
    }

    if (!accepted.length && !retiredIds.size) {
      return finish(report.skipped ?? undefined);
    }
    const bundle = buildCandidateBundle(gaBundle, {
      playbook,
      retiredIds,
      accepted,
    });
    const changeSet = {
      parentReleaseId: ga.id,
      parentVersion: ga.version,
      promptVersion: CURATOR_PROMPT_VERSION,
      changes: accepted.map(({ verdict, lessonId }) => ({
        lessonId,
        kind: verdict.change.kind,
        scope: verdict.scope,
        tenantId: verdict.tenantId,
        trackId: verdict.trackId,
        text: verdict.change.text.trim(),
        rationale: verdict.change.rationale,
        ...(verdict.change.policy
          ? { policy: { ...verdict.change.policy, from: verdict.from ?? null } }
          : {}),
        ...(verdict.change.prompt ? { prompt: verdict.change.prompt } : {}),
        evidence: verdict.evidence,
      })),
      retiredLessonIds: [...retiredIds],
    };
    const release = await this.releases.createCuratorDraft(
      ALLY_GUIDE_AGENT_KEY,
      bundle as unknown as Record<string, unknown>,
      changeSet,
      `Curator: ${accepted.length} change(s)` +
        (retiredIds.size ? `, ${retiredIds.size} lesson(s) retired` : '') +
        ` on v${ga.version}.`,
    );
    await this.lessons.update(
      { id: In(accepted.map((a) => a.lessonId)) },
      { releaseId: release.id, status: AgentLessonStatus.PROPOSED },
    );
    report.releaseId = release.id;
    report.releaseVersion = release.version;
    return finish(report.skipped ?? undefined);
  }

  private async ask(
    bundle: GuideReleaseBundle,
    clusters: EvidenceCluster[],
    playbook: Array<{ scope: string; text: string }>,
  ): Promise<{ text: string; usd: number }> {
    const anchors = new Map(
      RUBRIC_CRITERIA.map((c) => [`criterion:${c.id}`, c.fail]),
    );
    const policyKeys = Object.entries(GUIDE_POLICY_SCHEMA)
      .filter(
        ([, spec]) =>
          !spec.pinned &&
          !CURATOR_PROTECTED_GROUPS.includes(spec.group) &&
          (spec.type === 'int' || spec.type === 'number'),
      )
      .map(([key, spec]) => ({ key, spec }));
    const flat = flattenPolicy(bundle.policy);
    const { result, usd } = await this.models.complete({
      role: 'curator',
      bundle,
      task: LlmTask.GUIDE_CURATOR,
      aiTaskId: GUIDE_AI_TASKS.CURATOR,
      attribution: { costAgentKey: GUIDE_LEARNING_COST_KEY },
      request: {
        system: [{ text: CURATOR_SYSTEM_PROMPT, cache: true }],
        messages: [
          {
            role: 'user',
            content: buildCuratorMessage({
              evidence: clusters.map((c) => ({
                id: c.id,
                signal: c.signal,
                scope:
                  c.scope === AgentLessonScope.PLATFORM
                    ? 'everywhere'
                    : c.scope === AgentLessonScope.ORG
                      ? 'one organisation'
                      : 'one course',
                turns: c.turns,
                learners: c.learners,
                tenants: c.tenants,
                reasons: c.reasons,
                failAnchor: anchors.get(c.signal) ?? null,
              })),
              playbook,
              policy: policyKeys.map(({ key, spec }) => ({
                key,
                value: flat[key],
                min: spec.min,
                max: spec.max,
                description: spec.description,
              })),
              prompts: CURATOR_EDITABLE_ROLES.filter(
                (role) => bundle.prompts[role]?.text,
              ).map((role) => ({ role, text: bundle.prompts[role]!.text })),
            }),
          },
        ],
        maxTokens: CURATOR_MAX_TOKENS,
        outputSchema: CURATOR_OUTPUT_SCHEMA as unknown as Record<
          string,
          unknown
        >,
        timeoutMs: JUDGE_TIMEOUT_MS * 3,
      },
    });
    if (result.stopReason !== 'end_turn') {
      throw new Error(`the curator stopped with ${result.stopReason}`);
    }
    return {
      text: result.content
        .filter((block) => block.type === 'text')
        .map((block) => (block as { text: string }).text)
        .join(''),
      usd,
    };
  }

  /** Store one verdict as an agent_lessons row, and audit it. */
  private async saveVerdict(
    verdict: ChangeVerdict,
    actorKind: AgentReleaseAuthorKind,
    userId: number | null,
  ): Promise<AgentLesson> {
    const { change } = verdict;
    const status =
      verdict.outcome === 'accept'
        ? AgentLessonStatus.PROPOSED
        : verdict.outcome === 'quarantine'
          ? AgentLessonStatus.QUARANTINED
          : AgentLessonStatus.BLOCKED;
    let row: AgentLesson;
    if (change.approved) {
      await this.lessons.update(change.approved.lessonId, {
        status,
        blockReason: verdict.reason,
      });
      row = (await this.lessons.findOne({
        where: { id: change.approved.lessonId },
      }))!;
    } else {
      row = await this.lessons.save(
        this.lessons.create({
          agentKey: ALLY_GUIDE_AGENT_KEY,
          kind: change.kind,
          scope: verdict.scope,
          tenantId:
            verdict.scope === AgentLessonScope.ORG ? verdict.tenantId : null,
          trackId:
            verdict.scope === AgentLessonScope.COURSE ? verdict.trackId : null,
          status,
          // A blocked change keeps no copied words: the audit says why.
          text:
            verdict.reason === 'copied_text'
              ? '(withheld: it repeated a learner’s words)'
              : change.text.trim().slice(0, 400),
          change:
            verdict.reason === 'copied_text'
              ? null
              : change.policy
                ? {
                    key: change.policy.key,
                    from: verdict.from ?? null,
                    to: change.policy.value,
                  }
                : (change.prompt ?? null),
          rationale:
            verdict.reason === 'copied_text' ? null : change.rationale || null,
          evidence: { ...verdict.evidence, learners: verdict.learners },
          blockReason: verdict.reason,
          contentHash: changeHash(change, verdict),
          authorKind: AgentReleaseAuthorKind.CURATOR,
        }),
      );
    }
    await this.audit.record({
      action:
        verdict.outcome === 'accept'
          ? AgentLessonAuditAction.PROPOSED
          : verdict.outcome === 'quarantine'
            ? AgentLessonAuditAction.QUARANTINED
            : AgentLessonAuditAction.BLOCKED,
      actorKind,
      actorUserId: userId,
      lessonId: row.id,
      detail: {
        kind: change.kind,
        scope: verdict.scope,
        reason: verdict.reason,
        why: verdict.why,
        learners: verdict.learners,
      },
    });
    return row;
  }

  /**
   * Bring lesson statuses in line with the releases (the playbook frozen in
   * GA is the truth): a lesson in GA's playbook is ACTIVE; a proposed one
   * whose release was retired, or an active one a rollback took out, is
   * REJECTED. Audited.
   */
  async syncStatuses(): Promise<{ activated: number; rejected: number }> {
    const ga = await this.releases.getGa(ALLY_GUIDE_AGENT_KEY);
    if (!ga) return { activated: 0, rejected: 0 };
    const inGa = new Set(
      currentPlaybook(ga.bundle as unknown as GuideReleaseBundle).map(
        (l) => l.id,
      ),
    );
    const open = await this.lessons.find({
      where: {
        agentKey: ALLY_GUIDE_AGENT_KEY,
        status: In([AgentLessonStatus.PROPOSED, AgentLessonStatus.ACTIVE]),
      },
    });
    const releaseIds = [
      ...new Set(
        open.map((l) => l.releaseId).filter((id): id is string => Boolean(id)),
      ),
    ];
    const releaseRows = releaseIds.length
      ? await this.dataSource
          .getRepository(AgentRelease)
          .find({ where: { id: In(releaseIds) } })
      : [];
    const statusOf = new Map(releaseRows.map((r) => [r.id, r.status]));
    let activated = 0;
    let rejected = 0;
    for (const lesson of open) {
      const releaseStatus = lesson.releaseId
        ? statusOf.get(lesson.releaseId)
        : undefined;
      const isGaRelease = lesson.releaseId === ga.id;
      let next: AgentLessonStatus | null = null;
      let why = '';
      if (lesson.status === AgentLessonStatus.PROPOSED) {
        if (lesson.kind === 'lesson' ? inGa.has(lesson.id) : isGaRelease) {
          next = AgentLessonStatus.ACTIVE;
          why = `release v${ga.version} is GA`;
        } else if (releaseStatus === AgentReleaseStatus.RETIRED) {
          next = AgentLessonStatus.REJECTED;
          why = 'its release was stopped or reverted';
        }
      } else if (lesson.kind === 'lesson' && !inGa.has(lesson.id)) {
        next = AgentLessonStatus.REJECTED;
        why = `release v${ga.version} is GA and does not carry it (rolled back)`;
      }
      if (!next) continue;
      await this.lessons.update(lesson.id, { status: next });
      await this.audit.record({
        action:
          next === AgentLessonStatus.ACTIVE
            ? AgentLessonAuditAction.ACTIVATED
            : AgentLessonAuditAction.REJECTED,
        actorKind: AgentReleaseAuthorKind.SYSTEM,
        lessonId: lesson.id,
        releaseId: lesson.releaseId ?? null,
        detail: { why },
      });
      if (next === AgentLessonStatus.ACTIVE) activated++;
      else rejected++;
    }
    return { activated, rejected };
  }

  // ─── People ────────────────────────────────────────────────────────────

  list(query: { status?: string; scope?: string; limit?: number }) {
    return this.lessons.find({
      where: {
        agentKey: ALLY_GUIDE_AGENT_KEY,
        ...(query.status ? { status: query.status as AgentLessonStatus } : {}),
        ...(query.scope ? { scope: query.scope as AgentLessonScope } : {}),
      },
      order: { createdAt: 'DESC' },
      take: Math.min(Math.max(query.limit ?? 100, 1), 500),
    });
  }

  private async get(id: string): Promise<AgentLesson> {
    const lesson = await this.lessons.findOne({
      where: { id, agentKey: ALLY_GUIDE_AGENT_KEY },
    });
    if (!lesson) throw new NotFoundException('Lesson not found');
    return lesson;
  }

  /**
   * A person decides a quarantined change: approve (the next curator run
   * carries it, through every other guardrail again) or reject.
   */
  async decide(
    id: string,
    decision: 'approve' | 'reject',
    userId: number,
    notes?: string,
  ): Promise<AgentLesson> {
    const lesson = await this.get(id);
    const from = lesson.status;
    if (decision === 'approve' && from !== AgentLessonStatus.QUARANTINED) {
      throw new BadRequestException(
        'Only a quarantined change can be approved.',
      );
    }
    if (
      decision === 'reject' &&
      ![
        AgentLessonStatus.QUARANTINED,
        AgentLessonStatus.APPROVED,
        AgentLessonStatus.PROPOSED,
      ].includes(from)
    ) {
      throw new BadRequestException(`A ${from} change cannot be rejected.`);
    }
    const status =
      decision === 'approve'
        ? AgentLessonStatus.APPROVED
        : AgentLessonStatus.REJECTED;
    await this.lessons.update(id, {
      status,
      decidedBy: userId,
      decidedAt: new Date(),
    });
    await this.audit.record({
      action:
        decision === 'approve'
          ? AgentLessonAuditAction.APPROVED
          : AgentLessonAuditAction.REJECTED,
      actorKind: AgentReleaseAuthorKind.HUMAN,
      actorUserId: userId,
      lessonId: id,
      releaseId: lesson.releaseId ?? null,
      detail: { from, notes: notes ?? null },
    });
    return { ...lesson, status, decidedBy: userId };
  }

  /** Take an active lesson out of the playbook: the next curator release drops it. */
  async retire(
    id: string,
    userId: number,
    notes?: string,
  ): Promise<AgentLesson> {
    const lesson = await this.get(id);
    if (lesson.status !== AgentLessonStatus.ACTIVE) {
      throw new BadRequestException('Only an active lesson can be retired.');
    }
    await this.lessons.update(id, {
      status: AgentLessonStatus.RETIRED,
      decidedBy: userId,
      decidedAt: new Date(),
    });
    await this.audit.record({
      action: AgentLessonAuditAction.RETIRED,
      actorKind: AgentReleaseAuthorKind.HUMAN,
      actorUserId: userId,
      lessonId: id,
      detail: { notes: notes ?? null },
    });
    return { ...lesson, status: AgentLessonStatus.RETIRED };
  }

  /** The playbook the GA release carries, by scope, with each lesson's id. */
  async playbook() {
    const ga = await this.releases.getGa(ALLY_GUIDE_AGENT_KEY);
    if (!ga) return { releaseId: null, version: null, lessons: [] };
    const bundle = ga.bundle as unknown as GuideReleaseBundle;
    const policy = loopPolicy(bundle.policy);
    const lessons = currentPlaybook(bundle);
    const counts = countPlaybook(lessons);
    return {
      releaseId: ga.id,
      version: ga.version,
      caps: {
        platform: { used: counts.platform, max: policy.lessonCapPlatform },
        org: { max: policy.lessonCapOrg, used: Object.fromEntries(counts.org) },
        course: {
          max: policy.lessonCapCourse,
          used: Object.fromEntries(counts.course),
        },
      },
      lessons,
    };
  }
}

const isUuid = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
