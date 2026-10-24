import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { LoggerService } from 'src/logger/logger.service';
import { AgentEvalCase } from 'src/llm-agent/entity/agent-eval-case.entity';
import { AgentEvalSuite } from 'src/llm-agent/entity/agent-eval-suite.entity';
import {
  AgentEvalCaseSource,
  AgentEvalCaseStatus,
  AgentEvalSuiteKind,
} from 'src/llm-agent/harness/enum/eval.enum';
import { canonicalHash } from 'src/llm-agent/harness/release/canonical-hash.util';
import { ALLY_GUIDE_AGENT_KEY } from 'src/guide/release/guide-release.bundle';
import { HIDDEN_FOR_PRIVACY } from 'src/guide/safety/redaction';
import {
  failedChecks,
  runDeterministicChecks,
} from '../checks/deterministic-checks';
import {
  MAX_PROPOSED_PER_NIGHT,
  SUITE_KEYS,
} from '../constants/guide-learning.constants';
import { GuideWindowService } from '../windows/guide-window.service';
import { ProductionWindow } from '../windows/production-window';
import { counterfactualVariants } from './counterfactual';
import { GuideCaseExpectations } from './expectations';
import { redTeamCategory } from './categories';

/** A Playground input without the release: what a case replays. */
export interface GuideCaseInput {
  trackId: string;
  tenantId?: string | null;
  progress?: number;
  mode?: 'NORMAL' | 'CARE' | 'CRISIS_FOLLOWUP';
  guidance?: 'lead' | 'walk' | 'drive';
  channel?: 'text' | 'voice';
  visitor?: boolean;
  history?: Array<{ role: 'learner' | 'ally'; text: string }>;
  message: string;
  releaseWindowOpen?: boolean;
  quizOpen?: boolean;
  offSpineTurns?: number;
}

const SUITES: Array<{
  key: string;
  name: string;
  kind: AgentEvalSuiteKind;
  description: string;
}> = [
  {
    key: SUITE_KEYS.SMOKE,
    name: 'Smoke',
    kind: AgentEvalSuiteKind.SMOKE,
    description:
      'A short suite a draft can run in under ten minutes: one or two cases per hard category.',
  },
  {
    key: SUITE_KEYS.REGRESSION,
    name: 'Regression',
    kind: AgentEvalSuiteKind.REGRESSION,
    description:
      'Cases saved from real turns and proposed from failed ones, so a fixed failure stays fixed.',
  },
  {
    key: SUITE_KEYS.RED_TEAM,
    name: 'Red team',
    kind: AgentEvalSuiteKind.RED_TEAM,
    description:
      'Model-written adversarial cases, refreshed weekly; each runs only once a person accepts it.',
  },
];

/**
 * Eval cases (plans/ally-guide/plan.md §7.12–§7.13): saved from any turn
 * trace, proposed from failed turns, written by the red team, varied
 * counterfactually. Failure traces and success exemplars both belong here
 * (Stacks: Regression Trace Collection from Production Failures; Convert
 * Production Failures and Successes into Regression Tests).
 *
 * A case mined from a conversation stores the learner's words REDACTED, and
 * never one the Sentinel flagged as naming a real person.
 */
@Injectable()
export class GuideEvalCaseService {
  private readonly logger = LoggerService.getInstance(
    GuideEvalCaseService.name,
  );

  constructor(
    @InjectRepository(AgentEvalCase)
    private readonly cases: Repository<AgentEvalCase>,
    @InjectRepository(AgentEvalSuite)
    private readonly suites: Repository<AgentEvalSuite>,
    private readonly dataSource: DataSource,
    private readonly windows: GuideWindowService,
  ) {}

  /** A suite by key, created on first use. */
  async suite(key: string): Promise<AgentEvalSuite> {
    const spec = SUITES.find((s) => s.key === key);
    if (!spec) throw new BadRequestException(`Unknown suite ${key}`);
    await this.dataSource.query(
      `INSERT INTO "agent_eval_suites" ("agentKey", "key", "name", "kind", "description")
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT ("agentKey", "key") DO NOTHING`,
      [ALLY_GUIDE_AGENT_KEY, spec.key, spec.name, spec.kind, spec.description],
    );
    return (await this.suites.findOne({
      where: { agentKey: ALLY_GUIDE_AGENT_KEY, key },
    }))!;
  }

  async listSuites() {
    for (const spec of SUITES) await this.suite(spec.key);
    const rows: Array<Record<string, any>> = await this.dataSource.query(
      `SELECT s."id", s."key", s."name", s."kind", s."description",
              count(c."id") FILTER (WHERE c."status" = 'active') AS active,
              count(c."id") FILTER (WHERE c."status" = 'proposed') AS proposed,
              count(c."id") FILTER (WHERE c."status" = 'active' AND c."safety") AS safety
         FROM "agent_eval_suites" s
         LEFT JOIN "agent_eval_cases" c ON c."suiteId" = s."id"
        WHERE s."agentKey" = $1
        GROUP BY s."id" ORDER BY s."key"`,
      [ALLY_GUIDE_AGENT_KEY],
    );
    return rows.map((row) => ({
      ...row,
      active: Number(row.active),
      proposed: Number(row.proposed),
      safety: Number(row.safety),
    }));
  }

  /** Insert a case unless an identical one exists; returns it either way. */
  async insert(input: {
    suiteKey: string;
    source: AgentEvalCaseSource;
    status: AgentEvalCaseStatus;
    category: string;
    safety: boolean;
    title: string;
    input: GuideCaseInput;
    expectations: GuideCaseExpectations;
    parentCaseId?: string | null;
    sourceTurnId?: string | null;
    sourceThreadId?: string | null;
    createdBy?: number | null;
    notes?: string | null;
    tenantId?: string | null;
  }): Promise<{ case: AgentEvalCase; created: boolean }> {
    const suite = await this.suite(input.suiteKey);
    const contentHash = canonicalHash({
      input: input.input,
      expectations: input.expectations,
    });
    const existing = await this.cases.findOne({
      where: { agentKey: ALLY_GUIDE_AGENT_KEY, contentHash },
    });
    if (existing) return { case: existing, created: false };
    const saved = await this.cases.save(
      this.cases.create({
        agentKey: ALLY_GUIDE_AGENT_KEY,
        suiteId: suite.id,
        source: input.source,
        status: input.status,
        category: input.category.slice(0, 40),
        safety: input.safety,
        title: input.title.slice(0, 200),
        input: input.input as unknown as Record<string, unknown>,
        expectations: input.expectations as Record<string, unknown>,
        contentHash,
        parentCaseId: input.parentCaseId ?? null,
        sourceTurnId: input.sourceTurnId ?? null,
        sourceThreadId: input.sourceThreadId ?? null,
        createdBy: input.createdBy ?? null,
        notes: input.notes ?? null,
        tenantId: input.tenantId ?? null,
      }),
    );
    return { case: saved, created: true };
  }

  /**
   * A replayable input from a production window: the learner's redacted
   * words, the conditions the situation report recorded, the course and the
   * organisation. Null when the window cannot be saved without exposing a
   * real person.
   */
  async inputFromWindow(
    window: ProductionWindow,
  ): Promise<GuideCaseInput | null> {
    const learner = window.reviewable.learnerText;
    if (
      !window.turn.trackId ||
      !learner ||
      window.learnerFlagged ||
      learner === HIDDEN_FOR_PRIVACY
    ) {
      return null;
    }
    const [progress]: Array<{ completed: string }> = window.turn.userId
      ? await this.dataSource.query(
          `SELECT count(*) AS completed FROM "track_item_progress" tip
             JOIN "track_enrollments" te ON te."id" = tip."trackEnrollmentId"
            WHERE te."userId" = $1 AND te."trackId" = $2 AND tip."status" = 'COMPLETED'`,
          [window.turn.userId, window.turn.trackId],
        )
      : [{ completed: '0' }];
    const modeBefore = String(window.turn.summary?.modeBefore ?? 'NORMAL');
    return {
      trackId: window.turn.trackId,
      tenantId: window.turn.tenantId,
      progress: Number(progress?.completed ?? 0),
      mode:
        modeBefore === 'CARE' || modeBefore === 'CRISIS_FOLLOWUP'
          ? (modeBefore as GuideCaseInput['mode'])
          : 'NORMAL',
      guidance: window.situation?.guidance ?? 'walk',
      channel: window.window.channel,
      history: window.reviewable.recent
        .filter((m) => m.text && m.text !== HIDDEN_FOR_PRIVACY)
        .map((m) => ({ role: m.role, text: m.text })),
      message: learner,
      releaseWindowOpen: Boolean(window.window.releaseWindowOpen),
      quizOpen: Boolean(window.situation?.quizOpen),
    };
  }

  /** What a replay of this window should keep doing, or start doing. */
  expectationsFromWindow(
    window: ProductionWindow,
    kind: 'regression' | 'golden',
  ): GuideCaseExpectations {
    const sentinel = window.window.sentinel;
    const crisisVerdict =
      sentinel?.risk === 'crisis' &&
      (sentinel.about === 'self' || sentinel.about === 'unclear');
    const expectations: GuideCaseExpectations = { noPromptLeak: true };
    if (window.window.releaseWindowOpen) expectations.mustNotPresent = true;
    if (kind === 'golden') {
      expectations.crisis = window.window.reply.kind === 'crisis';
    } else if (crisisVerdict) {
      expectations.crisis = true;
    }
    return expectations;
  }

  /** "Save as eval case" from a turn trace (plan §7.12). */
  async saveFromTurn(
    turnId: string,
    userId: number,
    body: {
      kind?: 'regression' | 'golden';
      title?: string;
      category?: string;
      safety?: boolean;
      notes?: string;
      expectations?: GuideCaseExpectations;
      source?: AgentEvalCaseSource;
    },
  ) {
    const window = await this.windows.loadTurn(turnId, 4);
    if (!window) throw new NotFoundException('Turn not found');
    const input = await this.inputFromWindow(window);
    if (!input) {
      throw new ConflictException(
        "This turn can't be saved as a case: the learner's message named a real person or has no text",
      );
    }
    const kind = body.kind ?? 'regression';
    const category = body.category ?? kind;
    const expectations: GuideCaseExpectations = {
      ...this.expectationsFromWindow(window, kind),
      ...(body.expectations ?? {}),
    };
    const { case: saved, created } = await this.insert({
      suiteKey: SUITE_KEYS.REGRESSION,
      source: body.source ?? AgentEvalCaseSource.TRACE,
      status: AgentEvalCaseStatus.ACTIVE,
      category,
      safety:
        body.safety ??
        (window.safety ||
          Boolean(redTeamCategory(category)?.safety) ||
          expectations.crisis !== undefined),
      title: body.title?.trim() || `${kind} · turn ${turnId.slice(0, 8)}`,
      input,
      expectations,
      sourceTurnId: turnId,
      sourceThreadId: window.turn.threadId,
      createdBy: userId,
      notes: body.notes ?? null,
      tenantId: window.turn.tenantId,
    });
    return { case: this.summary(saved), duplicate: !created };
  }

  /**
   * Failed turns, proposed automatically (plan §7.12): a failed turn or a
   * failed deterministic check becomes a PROPOSED regression case. Nobody's
   * gate runs it until a person accepts it.
   */
  async proposeFromWindows(windows: ProductionWindow[]): Promise<number> {
    let proposed = 0;
    for (const window of windows) {
      if (proposed >= MAX_PROPOSED_PER_NIGHT) break;
      try {
        const input = await this.inputFromWindow(window);
        if (!input) continue;
        const failed = failedChecks(runDeterministicChecks(window.window));
        const { created } = await this.insert({
          suiteKey: SUITE_KEYS.REGRESSION,
          source: AgentEvalCaseSource.FAILED_TURN,
          status: AgentEvalCaseStatus.PROPOSED,
          category: 'regression',
          safety:
            window.safety ||
            failed.some((check) => check.severity === 'safety'),
          title: `${failed.map((c) => c.id).join(', ') || window.turn.status} · turn ${window.turn.id.slice(0, 8)}`,
          input,
          expectations: this.expectationsFromWindow(window, 'regression'),
          sourceTurnId: window.turn.id,
          sourceThreadId: window.turn.threadId,
          tenantId: window.turn.tenantId,
        });
        if (created) proposed++;
      } catch (error) {
        this.logger.warn(
          `Proposing a case from turn ${window.turn.id} failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
    return proposed;
  }

  /** A list row: no input text, which may hold a learner's words. */
  summary(row: AgentEvalCase) {
    return {
      id: row.id,
      suiteId: row.suiteId,
      source: row.source,
      status: row.status,
      category: row.category,
      safety: row.safety,
      title: row.title,
      parentCaseId: row.parentCaseId ?? null,
      sourceTurnId: row.sourceTurnId ?? null,
      createdAt: row.createdAt,
    };
  }

  async list(query: {
    suiteKey?: string;
    status?: string;
    category?: string;
    limit?: number;
  }) {
    const suite = query.suiteKey ? await this.suite(query.suiteKey) : null;
    const rows = await this.cases.find({
      where: {
        agentKey: ALLY_GUIDE_AGENT_KEY,
        ...(suite ? { suiteId: suite.id } : {}),
        ...(query.status
          ? { status: query.status as AgentEvalCaseStatus }
          : {}),
        ...(query.category ? { category: query.category } : {}),
      },
      order: { createdAt: 'DESC' },
      take: Math.min(Math.max(query.limit ?? 100, 1), 500),
    });
    return rows.map((row) => this.summary(row));
  }

  async get(id: string): Promise<AgentEvalCase> {
    const row = await this.cases.findOne({
      where: { id, agentKey: ALLY_GUIDE_AGENT_KEY },
    });
    if (!row) throw new NotFoundException('Eval case not found');
    return row;
  }

  async setStatus(id: string, status: AgentEvalCaseStatus) {
    const row = await this.get(id);
    await this.cases.update(row.id, { status });
    return this.summary({ ...row, status });
  }

  async update(
    id: string,
    patch: {
      title?: string;
      category?: string;
      safety?: boolean;
      expectations?: GuideCaseExpectations;
      notes?: string;
    },
  ) {
    const row = await this.get(id);
    const expectations = patch.expectations ?? row.expectations;
    await this.cases.update(row.id, {
      ...(patch.title ? { title: patch.title.slice(0, 200) } : {}),
      ...(patch.category ? { category: patch.category.slice(0, 40) } : {}),
      ...(patch.safety !== undefined ? { safety: patch.safety } : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      expectations:
        expectations as unknown as QueryDeepPartialEntity<AgentEvalCase>['expectations'],
      contentHash: canonicalHash({ input: row.input, expectations }),
    });
    return this.get(id);
  }

  /** A case written by hand in the Console. */
  async createManual(
    userId: number,
    body: {
      suiteKey?: string;
      category: string;
      safety?: boolean;
      title: string;
      input: GuideCaseInput;
      expectations?: GuideCaseExpectations;
      notes?: string;
    },
  ) {
    const { case: saved, created } = await this.insert({
      suiteKey: body.suiteKey ?? SUITE_KEYS.REGRESSION,
      source: AgentEvalCaseSource.MANUAL,
      status: AgentEvalCaseStatus.ACTIVE,
      category: body.category,
      safety: body.safety ?? Boolean(redTeamCategory(body.category)?.safety),
      title: body.title,
      input: body.input,
      expectations: body.expectations ?? {},
      createdBy: userId,
      notes: body.notes ?? null,
    });
    return { case: this.summary(saved), duplicate: !created };
  }

  /**
   * Counterfactual variants of a case: same expectations, a different
   * surface. They inherit the parent's status — variants of an accepted case
   * run in the next gate; variants of a proposed one wait with it.
   */
  async createVariants(id: string, userId: number) {
    const parent = await this.get(id);
    if (parent.source === AgentEvalCaseSource.COUNTERFACTUAL) {
      throw new BadRequestException('Vary the original case, not a variant');
    }
    const suite = await this.suites.findOne({ where: { id: parent.suiteId } });
    const out: Array<
      ReturnType<GuideEvalCaseService['summary']> & {
        kind: string;
        duplicate: boolean;
      }
    > = [];
    for (const variant of counterfactualVariants(
      parent.input as unknown as GuideCaseInput,
    )) {
      const { case: saved, created } = await this.insert({
        suiteKey: suite?.key ?? SUITE_KEYS.REGRESSION,
        source: AgentEvalCaseSource.COUNTERFACTUAL,
        status:
          parent.status === AgentEvalCaseStatus.ACTIVE
            ? AgentEvalCaseStatus.ACTIVE
            : AgentEvalCaseStatus.PROPOSED,
        category: parent.category,
        safety: parent.safety,
        title: `${parent.title} · ${variant.kind}`,
        input: variant.input,
        expectations: parent.expectations as GuideCaseExpectations,
        parentCaseId: parent.id,
        sourceTurnId: parent.sourceTurnId,
        sourceThreadId: parent.sourceThreadId,
        createdBy: userId,
        tenantId: parent.tenantId,
      });
      out.push({
        ...this.summary(saved),
        kind: variant.kind,
        duplicate: !created,
      });
    }
    return out;
  }

  /** Active cases for a run: a suite's, or every one. */
  async activeCases(suiteKey?: string): Promise<AgentEvalCase[]> {
    const suite = suiteKey ? await this.suite(suiteKey) : null;
    return this.cases.find({
      where: {
        agentKey: ALLY_GUIDE_AGENT_KEY,
        status: AgentEvalCaseStatus.ACTIVE,
        ...(suite ? { suiteId: suite.id } : {}),
      },
      order: { createdAt: 'ASC' },
    });
  }

  async byIds(ids: string[]): Promise<AgentEvalCase[]> {
    if (!ids.length) return [];
    return this.cases.find({ where: { id: In(ids) } });
  }
}
