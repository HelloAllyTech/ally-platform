import {
  AgentContentBlock,
  AgentMessage,
  AgentToolDefinition,
} from 'src/llm-agent/type/agent-llm.type';
import { PmAgentMemory } from '../entity/pm-agent-memory.entity';
import { PmAgentSettings } from '../entity/pm-agent-settings.entity';
import {
  PmCardCategory,
  PmCardSize,
  PmLane,
  PmLessonStatus,
  PmMemoryKind,
  PmMemorySource,
  PmRiskLevel,
} from '../enum/pm-agent.enum';
import {
  PM_PIPELINE,
  PM_PROMPT_CODES,
  PM_TASK_IDS,
} from '../constants/pm-agent-pipeline.constants';
import {
  memoryBlock,
  sharedContextBlock,
  topMemory,
} from '../learning/pm-context';
import { PmLlmPort, PmLlmStepRequest } from '../pipeline/pm-agent-llm.service';
import { PmContextSource, PmEvidenceRef } from '../pipeline/pm-pipeline.types';
import { PmAgentBudgetService } from '../service/pm-agent-budget.service';
import { fence } from '../util/fence.util';
import { PmRunLedger } from '../util/run-ledger';
import {
  buildDataPack,
  classifyRequiresConfirm,
  computeSupport,
  deriveScope,
  eligibleRows,
  isSupported,
  PmLessonCandidate,
  PmLessonDecisionRow,
  PmLessonSupport,
  predicateSignature,
  renderDataPack,
  sameIdea,
  validateLessonInput,
} from './pm-lesson-data';
import { pickEvalSample, replayAgreement } from './pm-lesson-eval';
import { lessonsBlock, topLessons } from './pm-lessons-context';
import {
  PM_LESSONS,
  PM_LESSONS_LANE,
  PM_LESSONS_PROMPT_CODE,
  PM_LESSONS_SUBMIT_TOOL,
  PM_LESSONS_TASK_ID,
  PmLessonsSkipReason,
} from './pm-lessons.constants';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Every read and write the job makes (the real one is PmLessonsSqlStore; tests fake it). */
export interface PmLessonsStore {
  getSettings(): Promise<PmAgentSettings>;
  decisionRows(lookbackDays: number): Promise<PmLessonDecisionRow[]>;
  /** Every lesson row, any status. */
  lessons(): Promise<PmAgentMemory[]>;
  activeFacts(): Promise<PmAgentMemory[]>;
  evidence(ids: string[]): Promise<PmEvidenceRef[]>;
  insertLesson(row: Partial<PmAgentMemory>): Promise<void>;
  updateLesson(id: string, patch: Partial<PmAgentMemory>): Promise<void>;
  monthCommittedUsd(now: Date): Promise<number>;
  tenantNames(): Promise<string[]>;
  saveLastRun(summary: PmLessonsRunSummary): Promise<void>;
}

export interface PmLessonsDeps {
  store: PmLessonsStore;
  llm: PmLlmPort;
  context: PmContextSource;
  now?: () => Date;
  log?: (level: 'info' | 'warn' | 'error', message: string) => void;
}

export interface PmLessonsRunSummary {
  status: 'completed' | 'skipped' | 'failed';
  reason?: string;
  startedAt: string;
  finishedAt?: string;
  decisions: number;
  submitted: number;
  invalid: number;
  unsupported: number;
  duplicates: number;
  resupported: number;
  evalFailed: number;
  activated: number;
  proposed: number;
  expired: number;
  spentUsd: number;
}

interface Planned {
  candidate: PmLessonCandidate;
  support: PmLessonSupport;
  requiresConfirm: boolean;
  /** An expired lesson this re-derives: updated in place instead of inserted. */
  reviveId?: string;
}

const lessonTool: AgentToolDefinition = {
  name: PM_LESSONS_SUBMIT_TOOL,
  description:
    'Submit candidate lessons (at most 8). Each states one pattern in the decisions as a plain ' +
    'sentence plus the structured condition it is about. Code recomputes support from the data ' +
    'and drops anything the data does not back. Call once.',
  input_schema: {
    type: 'object',
    properties: {
      lessons: {
        type: 'array',
        maxItems: PM_LESSONS.MAX_CANDIDATES,
        items: {
          type: 'object',
          properties: {
            text: {
              type: 'string',
              description: `${PM_LESSONS.TEXT_MIN}-${PM_LESSONS.TEXT_MAX} characters, one plain sentence`,
            },
            expects: { type: 'string', enum: ['accept', 'reject'] },
            predicate: {
              type: 'object',
              properties: {
                categories: {
                  type: 'array',
                  items: {
                    type: 'string',
                    enum: Object.values(PmCardCategory),
                  },
                },
                lanes: {
                  type: 'array',
                  items: { type: 'string', enum: Object.values(PmLane) },
                },
                sizes: {
                  type: 'array',
                  items: { type: 'string', enum: Object.values(PmCardSize) },
                },
                risks: {
                  type: 'array',
                  items: { type: 'string', enum: Object.values(PmRiskLevel) },
                },
                words: {
                  type: 'array',
                  items: { type: 'string' },
                  description:
                    'Lower-case title words from the data pack (any of)',
                },
              },
            },
            citedRefs: { type: 'array', items: { type: 'string' } },
          },
          required: ['text', 'expects', 'predicate'],
        },
      },
    },
    required: ['lessons'],
  },
};

/**
 * The weekly lessons job (docs/pm-agent.md "Weekly lessons"; plan §9b loop 5), framework-free.
 *
 * read 90 days of decisions → anonymised data pack → one reflection call (`submit_lessons`,
 * schema-checked, one repair) → per candidate, in code: support recomputed (≥ 5 supporting,
 * ≥ 75% consistent, else dropped), dedupe against facts and lessons (a match on an active or
 * proposed lesson re-supports it), requiresConfirm classified → eval gate (critic replay before
 * vs after) → active / proposed / dropped → expiry of lessons not re-supported for 60 days.
 *
 * Budget: one cap per job (the run cap formula), a ledger with the eval gate's share held back
 * from the reflection, and every call reserving before it spends. A shortfall at the eval gate
 * leaves the lesson `proposed` with no evalResult — never active.
 */
export class PmLessonsJob {
  private readonly now: () => Date;
  private readonly log: NonNullable<PmLessonsDeps['log']>;

  constructor(private readonly deps: PmLessonsDeps) {
    this.now = deps.now ?? (() => new Date());
    this.log = deps.log ?? (() => undefined);
  }

  /** Why the job may not start now, or null. Costs nothing. */
  async preflight(
    settings: PmAgentSettings,
    now: Date = this.now(),
  ): Promise<{ reason: PmLessonsSkipReason | null; capUsd: number }> {
    if (!settings.enabled) {
      return { reason: PmLessonsSkipReason.DISABLED, capUsd: 0 };
    }
    if (settings.lessonsEnabled === false) {
      return { reason: PmLessonsSkipReason.LESSONS_DISABLED, capUsd: 0 };
    }
    const committed = await this.deps.store.monthCommittedUsd(now);
    const capUsd = PmAgentBudgetService.runCapUsd(
      Number(settings.monthlyBudgetUsd),
      committed,
      PM_PIPELINE.RUN_BUDGET_DIVISOR,
    );
    if (capUsd < PM_PIPELINE.MIN_RUN_BUDGET_USD) {
      return { reason: PmLessonsSkipReason.BUDGET_EXHAUSTED, capUsd };
    }
    return { reason: null, capUsd };
  }

  async run(runId: string): Promise<PmLessonsRunSummary> {
    const { store } = this.deps;
    const now = this.now();
    const summary: PmLessonsRunSummary = {
      status: 'completed',
      startedAt: now.toISOString(),
      decisions: 0,
      submitted: 0,
      invalid: 0,
      unsupported: 0,
      duplicates: 0,
      resupported: 0,
      evalFailed: 0,
      activated: 0,
      proposed: 0,
      expired: 0,
      spentUsd: 0,
    };
    const resupported = new Set<string>();
    let ledger: PmRunLedger | null = null;
    try {
      const settings = await store.getSettings();
      const pre = await this.preflight(settings, now);
      if (pre.reason) {
        summary.status = 'skipped';
        summary.reason = pre.reason;
        return summary;
      }
      const [allRows, existing, facts, tenantNames] = await Promise.all([
        store.decisionRows(PM_LESSONS.LOOKBACK_DAYS),
        store.lessons(),
        store.activeFacts(),
        store.tenantNames(),
      ]);
      const rows = eligibleRows(allRows);
      summary.decisions = rows.length;
      if (rows.length < PM_LESSONS.MIN_SUPPORT) {
        summary.status = 'skipped';
        summary.reason = PmLessonsSkipReason.NOT_ENOUGH_DECISIONS;
        return summary;
      }

      ledger = new PmRunLedger(pre.capUsd, PM_LESSONS.EVAL_SHARE);
      ledger.setLaneCount(1);

      // ── reflection ────────────────────────────────────────────────────────
      const raw = await this.reflect(
        runId,
        rows,
        existing,
        now,
        tenantNames,
        ledger,
      );
      if (raw.status !== 'ok') {
        summary.status = raw.status === 'budget' ? 'skipped' : 'failed';
        summary.reason =
          raw.status === 'budget'
            ? PmLessonsSkipReason.BUDGET_EXHAUSTED
            : raw.status;
        return summary;
      }
      summary.submitted = raw.submitted;
      summary.invalid = raw.invalid;

      // ── deterministic validation, dedupe, classification ──────────────────
      const planned: Planned[] = [];
      const seenSignatures = new Set<string>();
      for (const candidate of raw.candidates) {
        const support = computeSupport(rows, candidate);
        if (!isSupported(support)) {
          summary.unsupported += 1;
          continue;
        }
        const signature = predicateSignature(candidate);
        if (
          seenSignatures.has(signature) ||
          planned.some((p) => sameIdea(p.candidate.text, candidate.text))
        ) {
          summary.duplicates += 1;
          continue;
        }
        seenSignatures.add(signature);
        if (facts.some((fact) => sameIdea(fact.value, candidate.text))) {
          summary.duplicates += 1;
          continue;
        }
        const match = existing.find(
          (lesson) =>
            lesson.key === `lesson:${signature}` ||
            sameIdea(lesson.value, candidate.text),
        );
        if (match?.lessonStatus === PmLessonStatus.REMOVED) {
          // An admin removed it: the job does not bring it back.
          summary.duplicates += 1;
          continue;
        }
        if (
          match &&
          (match.lessonStatus === PmLessonStatus.ACTIVE ||
            match.lessonStatus === PmLessonStatus.PROPOSED)
        ) {
          await store.updateLesson(match.id, {
            lastSupportedAt: now,
            expiresAt:
              match.source === PmMemorySource.MANUAL
                ? (match.expiresAt ?? null)
                : new Date(now.getTime() + PM_LESSONS.EXPIRY_DAYS * DAY_MS),
            supportCount: support.supporting,
            supportRatio: support.ratio.toFixed(3),
            confidence: support.ratio.toFixed(3),
            evidenceCardIds: support.supportingCardIds,
          });
          resupported.add(match.id);
          summary.resupported += 1;
          continue;
        }
        planned.push({
          candidate,
          support,
          requiresConfirm: classifyRequiresConfirm(candidate),
          reviveId:
            match?.lessonStatus === PmLessonStatus.EXPIRED
              ? match.id
              : undefined,
        });
      }

      // ── eval gate ─────────────────────────────────────────────────────────
      const evals = await this.evaluate(
        runId,
        planned,
        rows,
        existing,
        facts,
        settings,
        now,
        ledger,
      );

      for (const [index, plan] of planned.entries()) {
        const evalResult = evals[index];
        if (evalResult && !evalResult.passed) {
          summary.evalFailed += 1;
          continue;
        }
        const status =
          evalResult && !plan.requiresConfirm
            ? PmLessonStatus.ACTIVE
            : PmLessonStatus.PROPOSED;
        const { scope, category, lane } = deriveScope(plan.candidate.predicate);
        const row: Partial<PmAgentMemory> = {
          kind: PmMemoryKind.LESSON,
          key: `lesson:${predicateSignature(plan.candidate)}`,
          value: plan.candidate.text,
          scope,
          category,
          lane,
          source: PmMemorySource.WEEKLY_JOB,
          active: status === PmLessonStatus.ACTIVE,
          lessonStatus: status,
          supportCount: plan.support.supporting,
          supportRatio: plan.support.ratio.toFixed(3),
          confidence: plan.support.ratio.toFixed(3),
          evidenceCardIds: plan.support.supportingCardIds,
          evalResult: evalResult ?? null,
          requiresConfirm: plan.requiresConfirm,
          lastSupportedAt: now,
          expiresAt: new Date(now.getTime() + PM_LESSONS.EXPIRY_DAYS * DAY_MS),
          predicate: {
            ...plan.candidate.predicate,
            expects: plan.candidate.expects,
          },
        };
        if (plan.reviveId) {
          await store.updateLesson(plan.reviveId, row);
          resupported.add(plan.reviveId);
        } else {
          await store.insertLesson(row);
        }
        if (status === PmLessonStatus.ACTIVE) summary.activated += 1;
        else summary.proposed += 1;
      }
      return summary;
    } catch (error) {
      summary.status = 'failed';
      summary.reason = (
        error instanceof Error ? error.message : String(error)
      ).slice(0, 300);
      this.log('error', `[PM_AGENT] Lessons job failed: ${summary.reason}`);
      return summary;
    } finally {
      summary.expired = await this.expire(now, resupported).catch(() => 0);
      summary.spentUsd = ledger?.spent ?? 0;
      summary.finishedAt = this.now().toISOString();
      await store.saveLastRun(summary).catch(() => undefined);
    }
  }

  /** Lessons (job-derived, active or proposed) not re-supported for 60 days → expired. */
  private async expire(now: Date, resupported: Set<string>): Promise<number> {
    const lessons = await this.deps.store.lessons();
    let count = 0;
    for (const lesson of lessons) {
      if (resupported.has(lesson.id)) continue;
      if (lesson.source === PmMemorySource.MANUAL) continue;
      if (
        lesson.lessonStatus !== PmLessonStatus.ACTIVE &&
        lesson.lessonStatus !== PmLessonStatus.PROPOSED
      ) {
        continue;
      }
      const last = lesson.lastSupportedAt ?? lesson.createdAt;
      if (!last) continue;
      if (
        now.getTime() - new Date(last).getTime() <
        PM_LESSONS.EXPIRY_DAYS * DAY_MS
      ) {
        continue;
      }
      await this.deps.store.updateLesson(lesson.id, {
        lessonStatus: PmLessonStatus.EXPIRED,
        active: false,
      });
      count += 1;
    }
    return count;
  }

  private async reflect(
    runId: string,
    rows: PmLessonDecisionRow[],
    existing: PmAgentMemory[],
    now: Date,
    tenantNames: string[],
    ledger: PmRunLedger,
  ): Promise<
    | {
        status: 'ok';
        candidates: PmLessonCandidate[];
        submitted: number;
        invalid: number;
      }
    | { status: 'budget' | 'failed' | 'no_submit' }
  > {
    const { llm } = this.deps;
    const [prompt, target] = await Promise.all([
      llm.loadPrompt(PM_LESSONS_PROMPT_CODE),
      llm.resolveTarget(PM_LESSONS_TASK_ID, PM_LESSONS_PROMPT_CODE, false),
    ]);
    const pack = buildDataPack(rows, now, tenantNames);
    const known = existing
      .filter(
        (lesson) =>
          lesson.lessonStatus === PmLessonStatus.ACTIVE ||
          lesson.lessonStatus === PmLessonStatus.PROPOSED,
      )
      .slice(0, 20);
    const messages: AgentMessage[] = [
      {
        role: 'user',
        content: [
          `Decisions from the last ${PM_LESSONS.LOOKBACK_DAYS} days, one JSON object per line (${pack.rows.length} cards).`,
          fence(
            'tool_data',
            { source: 'pm_agent_decisions', kind: 'data_pack' },
            renderDataPack(pack.rows),
            PM_LESSONS.PACK_MAX_CHARS,
          ),
          known.length
            ? [
                'Lessons already known (do not resubmit them reworded):',
                ...known.map((lesson) =>
                  fence('memory', { kind: 'lesson' }, lesson.value, 300),
                ),
              ].join('\n')
            : 'No lessons are known yet.',
          `Call ${PM_LESSONS_SUBMIT_TOOL} once.`,
        ].join('\n\n'),
      },
    ];
    const request = (): PmLlmStepRequest => ({
      runId,
      lane: PM_LESSONS_LANE,
      kind: 'lane',
      taskId: PM_LESSONS_TASK_ID,
      promptCode: PM_LESSONS_PROMPT_CODE,
      promptVersion: prompt.version,
      target,
      system: [{ text: prompt.text }],
      messages: [...messages],
      tools: [lessonTool],
      maxTokens: PM_LESSONS.REFLECTION_MAX_TOKENS,
      timeoutMs: PM_PIPELINE.CALL_TIMEOUT_MS,
      ledger,
    });

    const valid: PmLessonCandidate[] = [];
    let submitted = 0;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const step = await llm.step(request());
      if (step.status !== 'ok') {
        if (attempt === 0 || !valid.length) return { status: step.status };
        break; // the repair could not run: keep what validated
      }
      const use = step.turn.content.find(
        (block): block is Extract<AgentContentBlock, { type: 'tool_use' }> =>
          block.type === 'tool_use' && block.name === PM_LESSONS_SUBMIT_TOOL,
      );
      if (!use || step.turn.stopReason === 'max_tokens') {
        if (attempt === 1) break;
        messages.push({ role: 'assistant', content: step.turn.content });
        messages.push({
          role: 'user',
          content: `No complete ${PM_LESSONS_SUBMIT_TOOL} call was received. Call it once, now, with at most ${PM_LESSONS.MAX_CANDIDATES} short lessons.`,
        });
        continue;
      }
      const items: unknown[] = Array.isArray(use.input?.lessons)
        ? use.input.lessons.slice(0, PM_LESSONS.MAX_CANDIDATES)
        : [];
      if (attempt === 0) submitted = items.length;
      const errors: string[] = [];
      items.forEach((item, index) => {
        const check = validateLessonInput(item, tenantNames);
        if (check.candidate) valid.push(check.candidate);
        else errors.push(`lesson ${index}: ${check.error}`);
      });
      if (!errors.length || attempt === 1) break;
      // One repair: the valid ones are kept; only the failures are asked for again.
      messages.push({ role: 'assistant', content: step.turn.content });
      messages.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: use.id,
            is_error: true,
            content: `${valid.length} lesson(s) accepted. Fix and resubmit ONLY these (others are kept):\n${errors.join('\n')}`,
          },
        ],
      });
    }
    if (!submitted && !valid.length) return { status: 'no_submit' };
    // Invalid = first-pass items that never validated, even after the repair.
    return {
      status: 'ok',
      candidates: valid,
      submitted,
      invalid: Math.max(0, submitted - valid.length),
    };
  }

  private async evaluate(
    runId: string,
    planned: Planned[],
    rows: PmLessonDecisionRow[],
    existing: PmAgentMemory[],
    facts: PmAgentMemory[],
    settings: PmAgentSettings,
    now: Date,
    ledger: PmRunLedger,
  ): Promise<(PmAgentMemory['evalResult'] | null)[]> {
    const none = planned.map(() => null);
    if (!planned.length) return none;
    const sample = pickEvalSample(rows);
    if (sample.length < PM_LESSONS.EVAL_MIN_SAMPLE) return none;

    const { llm, store, context } = this.deps;
    const [prompt, target, shared] = await Promise.all([
      llm.loadPrompt(PM_PROMPT_CODES.CRITIC),
      llm.resolveTarget(PM_TASK_IDS.CRITIC, PM_PROMPT_CODES.CRITIC, false),
      context.sharedContext(settings),
    ]);
    const evidenceIds = [
      ...new Set(
        sample.flatMap((row) =>
          Array.isArray(row.payload?.evidenceIds)
            ? row.payload.evidenceIds.map(String)
            : [],
        ),
      ),
    ];
    const evidence = new Map(
      (await store.evidence(evidenceIds)).map((ref) => [ref.id, ref]),
    );
    const factsText = memoryBlock(
      topMemory(facts, 'scope risk decision strategy rejected', now),
    );
    const active = topLessons(existing, now);
    const base = {
      llm,
      runId,
      target,
      promptText: prompt.text,
      promptVersion: prompt.version,
      sharedContext: sharedContextBlock(shared),
      sample,
      evidence,
      ledger,
    };
    const before = await replayAgreement({
      ...base,
      memoryText: [factsText, lessonsBlock(active)]
        .filter(Boolean)
        .join('\n\n'),
    });
    if (before === null) return none;

    const out: (PmAgentMemory['evalResult'] | null)[] = [];
    for (const plan of planned) {
      const probe = {
        value: plan.candidate.text,
        scope: deriveScope(plan.candidate.predicate).scope,
        supportCount: plan.support.supporting,
        supportRatio: plan.support.ratio.toFixed(3),
      } as PmAgentMemory;
      const after = await replayAgreement({
        ...base,
        memoryText: [
          factsText,
          lessonsBlock([
            ...active.slice(0, PM_LESSONS.MAX_INJECTED - 1),
            probe,
          ]),
        ].join('\n\n'),
      });
      if (after === null) {
        this.log(
          'info',
          `[PM_AGENT] Lessons eval skipped (budget/critic) for one candidate.`,
        );
        out.push(null);
        continue;
      }
      out.push({
        passed: after >= before && sample.length >= PM_LESSONS.EVAL_MIN_SAMPLE,
        agreementBefore: before,
        agreementAfter: after,
        sampleSize: sample.length,
      });
    }
    return out;
  }
}
