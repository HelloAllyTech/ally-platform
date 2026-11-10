import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, LessThan, MoreThan, Repository } from 'typeorm';
import type {
  CheckupGradeRequest,
  CheckupGradeResponse,
} from '../../ai/dto/checkup.dto';
import { AiService } from '../../ai/service/ai.service';
import {
  AgentRuntimeUsed,
  ChatbotMemberRole,
} from '../../chatbot/enum/chatbot.enum';
import { ChatbotAccessService } from '../../chatbot/service/chatbot-access.service';
import { ChatbotSettingsService } from '../../chatbot/service/chatbot-settings.service';
import {
  ChatbotService,
  ChatbotTestResult,
} from '../../chatbot/service/chatbot.service';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { LoggerService } from '../../logger/logger.service';
import {
  ChatbotCheckupCase,
  ChatbotCheckupResult,
  ChatbotCheckupRun,
  CheckupTrigger,
} from '../entity/chatbot-checkup.entity';
import { checkupTotals, StatInput } from './checkup-stats';
import { attemptsFor, gradedFacts, resultOf } from './checkup-cases';
import type { PlannedCase } from './checkup-generation';

/** The plain-text sources list a channel without a sources view gets (reply-composer.ts). */
export const withoutSourcesFooter = (reply: string): string =>
  reply.replace(/\n\nSources:\n[\s\S]*$/, '');

/** A checkup runs this long after the last change, so a burst of edits runs it once. */
export const AFTER_CHANGE_DELAY_MS = 2 * 60 * 1000;

export const CHECKUP_PROMPT_CODES = ['ally_ai_checkup_judge'] as const;

export const CHECKUP_LIMITS = {
  /** Runs an owner can start per assistant per day (evals don't count; they're admin-only). */
  runsPerDay: 5,
  /** Questions asked per run. */
  questionsPerRun: 25,
  /** Questions asked at once (6 keeps onboarding's checkup to about a minute). */
  concurrency: 6,
  /** An eval asks each question up to this many times, because wording varies run to run. */
  maxAttempts: 3,
} as const;

/** One suite question as an eval file writes it (docs/agents-v2/evals/*.yaml). */
export interface SuiteCase {
  id: string;
  send: string;
  expect: ChatbotCheckupCase['expect'];
  thread?: string;
  facts?: string[];
  must_not?: string[];
  also_ok?: string[];
  source?: string;
  hard_fail?: boolean;
  tier?: 'must_pass' | 'nice_to_pass';
}

export interface StartRun {
  trigger: CheckupTrigger;
  suite?: string | null;
  /** Every question this many times (evals). Without it, home runs ask Must pass ones 3 times. */
  attempts?: number;
  draftId?: string | null;
  /** Only the questions that didn't pass last time (chunk 20d-2). */
  only?: 'all' | 'failed';
}

/** One graded question as the Checkup screens show it. */
export interface CheckupResultView {
  caseId: string;
  question: string;
  expect: ChatbotCheckupCase['expect'];
  verdict: ChatbotCheckupResult['verdict'];
  outcome: string;
  reasons: string[];
  hardFail: boolean;
  /** A safety question from the pack: never removed, edited or paused. */
  safety: boolean;
  source: ChatbotCheckupCase['source'];
  reply: string;
  /** Which try this was (Must pass questions are asked 3 times on the home). */
  attempt: number;
  tier: ChatbotCheckupCase['tier'];
  origin: ChatbotCheckupCase['origin'];
  citations: ChatbotCheckupResult['citations'];
  ms: number;
}

export interface CheckupRunView {
  run: Pick<
    ChatbotCheckupRun,
    | 'id'
    | 'status'
    | 'total'
    | 'done'
    | 'startedAt'
    | 'finishedAt'
    | 'phase'
    | 'asked'
    | 'only'
    | 'trigger'
  >;
  totals: Record<string, unknown>;
  results: CheckupResultView[];
}

type Group = { thread: string | null; cases: ChatbotCheckupCase[] };

/** What the judge reads besides the passages: the owner's wording and setup. */
interface GradeContext {
  declineText?: string;
  about?: string;
}

/**
 * The Checkup (chunk 20a-2): asks an assistant its checkup questions through its own engine (the
 * Preview path, so crisis handling, the safety pack and the answer check all apply), grades each
 * reply with ally-ai's one grader and keeps the results. The numbers come from `checkupTotals`.
 */
@Injectable()
export class CheckupService {
  constructor(
    @InjectRepository(ChatbotCheckupCase)
    private readonly cases: Repository<ChatbotCheckupCase>,
    @InjectRepository(ChatbotCheckupRun)
    private readonly runs: Repository<ChatbotCheckupRun>,
    @InjectRepository(ChatbotCheckupResult)
    private readonly results: Repository<ChatbotCheckupResult>,
    private readonly access: ChatbotAccessService,
    private readonly chatbots: ChatbotService,
    private readonly ai: AiService,
    private readonly settings?: ChatbotSettingsService,
  ) {}

  private readonly logger = LoggerService.getInstance(CheckupService.name);

  /** Adds or updates an eval suite's questions on an assistant, matched by the suite's own ids. */
  async importSuite(
    chatbotId: string,
    suite: string,
    items: SuiteCase[],
  ): Promise<{ added: number; updated: number }> {
    await this.access.assertPlatformAdmin();
    await this.access.assert(chatbotId, ChatbotMemberRole.EDITOR);
    const pages = await this.pageDocuments(chatbotId);
    const existing = await this.cases.find({ where: { chatbotId, suite } });
    const byId = new Map(existing.map((row) => [row.externalId, row]));
    let added = 0;
    let updated = 0;
    const rows = items.map((item, index) => {
      const row = byId.get(item.id) ?? this.cases.create({ chatbotId, suite });
      if (row.id) updated += 1;
      else added += 1;
      return Object.assign(row, {
        externalId: item.id,
        question: item.send,
        expect: item.expect,
        thread: item.thread ?? null,
        facts: item.facts ?? [],
        mustNot: item.must_not ?? [],
        alsoOk: item.also_ok ?? [],
        source: CheckupService.suiteSource(item.source, pages),
        hardFail: Boolean(item.hard_fail),
        tier: item.tier ?? 'must_pass',
        origin: 'suite' as const,
        confirmed: true,
        status: 'active' as const,
        position: index,
        createdBy: Number(ExecutionManager.getUserId() ?? 0) || null,
      });
    });
    await this.cases.save(rows);
    return { added, updated };
  }

  /** A suite question's source: a page URL becomes that page's document on this assistant. */
  static suiteSource(
    source: string | undefined,
    pages: Map<string, string>,
  ): ChatbotCheckupCase['source'] {
    if (!source) return { kind: '' };
    if (/^https?:\/\//.test(source)) {
      const url = source.replace(/\/+$/, '');
      const documentId = pages.get(url);
      return documentId
        ? { kind: 'page', url, document_id: documentId }
        : { kind: 'page', url };
    }
    return { kind: 'document', title: source };
  }

  /** The assistant's documents read from a web page, by URL (without a trailing slash). */
  private async pageDocuments(chatbotId: string): Promise<Map<string, string>> {
    const rows = await this.cases.manager.query<
      { id: string; source_url: string }[]
    >(
      `SELECT d.id, d.source_url FROM kb_documents d
         JOIN chatbot_documents cd ON cd.document_id = d.id
        WHERE cd.chatbot_id = $1 AND d.source_url IS NOT NULL AND d.archived_at IS NULL`,
      [chatbotId],
    );
    return new Map(
      rows.map((row) => [row.source_url.replace(/\/+$/, ''), row.id]),
    );
  }

  /**
   * Replaces the generated questions the owner hasn't confirmed with `planned`; the owner's own,
   * confirmed ones, suite questions and the platform's are never deleted. Platform questions are
   * added once (a pack upgrade adds new ones, never removes).
   */
  async generate(chatbotId: string, planned: PlannedCase[]): Promise<void> {
    await this.cases.manager.transaction(async (manager) => {
      const repo = manager.getRepository(ChatbotCheckupCase);
      const existing = await repo.find({ where: { chatbotId } });
      const generation = Math.max(0, ...existing.map((c) => c.generation)) + 1;
      const stale = existing.filter(
        (c) => c.origin === 'generated' && !c.confirmed,
      );
      if (stale.length) await repo.delete(stale.map((c) => c.id));
      const kept = new Set(
        existing
          .filter((c) => c.origin !== 'generated' || c.confirmed)
          .map((c) => c.externalId ?? c.question.toLowerCase()),
      );
      const rows = planned
        .filter(
          (p) =>
            !kept.has(p.key) &&
            !(p.origin === 'generated' && kept.has(p.question.toLowerCase())),
        )
        .map((p, index) =>
          repo.create({
            chatbotId,
            question: p.question.slice(0, 500),
            expect: p.expect,
            facts: p.facts,
            mustNot: p.mustNot,
            alsoOk: p.alsoOk,
            source: p.source,
            origin: p.origin,
            confirmed: false,
            status: 'active',
            hardFail: p.hardFail,
            tier: p.tier,
            position: index,
            externalId: p.origin === 'platform' ? p.key : null,
            packId: p.packId ?? null,
            packVersion: p.packVersion ?? null,
            generation,
            createdBy: Number(ExecutionManager.getUserId() ?? 0) || null,
          }),
        );
      if (rows.length) await repo.save(rows);
    });
  }

  async start(
    chatbotId: string,
    options: StartRun,
  ): Promise<ChatbotCheckupRun> {
    const { chatbot } = await this.access.assert(
      chatbotId,
      ChatbotMemberRole.EDITOR,
    );
    const attempts = Math.min(
      Math.max(options.attempts ?? 1, 1),
      CHECKUP_LIMITS.maxAttempts,
    );
    if (options.trigger === 'eval' || (options.attempts ?? 1) > 1) {
      await this.access.assertPlatformAdmin();
    } else {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const today = await this.runs.count({
        where: {
          chatbotId,
          startedAt: MoreThan(since),
          trigger: In(['manual', 'after_change', 'onboarding']),
        },
      });
      if (today >= CHECKUP_LIMITS.runsPerDay) {
        throw new HttpException(
          { code: 'checkup_limit', message: 'checkup_limit' },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    const cases = await this.cases.find({
      where: {
        chatbotId,
        status: 'active',
        deletedAt: IsNull(),
        // A run asks the assistant's own questions; an eval asks one suite's.
        ...(options.suite ? { suite: options.suite } : { suite: IsNull() }),
      },
      order: { position: 'ASC', createdAt: 'ASC' },
    });
    const limit =
      options.trigger === 'eval'
        ? cases.length
        : CHECKUP_LIMITS.questionsPerRun;
    const failedOnly = options.only === 'failed';
    const chosen = failedOnly ? await this.notPassed(chatbotId, cases) : cases;
    const asked = chosen.slice(0, limit);
    if (!asked.length) throw new BadRequestException('no_checkup_questions');
    // Evals ask every question `attempts` times; home runs ask Must pass ones 3 times.
    const attemptsOf = (item: ChatbotCheckupCase) =>
      options.attempts ? attempts : attemptsFor(item, options.trigger);

    const run = await this.runs.save(
      this.runs.create({
        chatbotId,
        draftId: options.draftId ?? null,
        trigger: options.trigger,
        suite: options.suite ?? null,
        status: 'running',
        total: asked.reduce((sum, item) => sum + attemptsOf(item), 0),
        done: 0,
        asked: 0,
        phase: 'asking',
        only: failedOnly ? 'failed' : 'all',
        startedBy: Number(ExecutionManager.getUserId() ?? 0) || null,
      }),
    );
    // Not awaited: the caller polls the run. The request's user context carries into the work.
    // The assistant's "when it doesn't know" wording: every decline carries its
    // contact, so the judge reads it as a source.
    const declineText = this.settings
      ? ((await this.settings.getForChatbot(chatbot)).declineText ?? '')
      : '';
    // What the assistant may say about itself: its introduction and instructions.
    const about = [chatbot?.persona?.greeting, chatbot?.persona?.systemPrompt]
      .filter(Boolean)
      .join('\n');
    void this.execute(run, asked, attemptsOf, { declineText, about }).catch(
      async (error: unknown) => {
        this.logger.error(
          `Checkup run ${run.id} failed: ${error instanceof Error ? error.name : 'error'}`,
        );
        await this.runs.update(
          { id: run.id },
          { status: 'failed', finishedAt: new Date() },
        );
      },
    );
    return run;
  }

  private readonly pending = new Map<string, NodeJS.Timeout>();

  /**
   * A checkup run after a change, 2 minutes after the last one (chunk 20a-2), within the daily
   * limit. Nothing happens for an assistant without checkup questions.
   */
  scheduleAfterChange(
    chatbotId: string,
    delayMs = AFTER_CHANGE_DELAY_MS,
  ): void {
    clearTimeout(this.pending.get(chatbotId));
    const timer = setTimeout(() => {
      this.pending.delete(chatbotId);
      void this.start(chatbotId, { trigger: 'after_change' }).catch(() => {
        // No questions yet, or the day's runs are used up: the next change tries again.
      });
    }, delayMs);
    timer.unref?.();
    this.pending.set(chatbotId, timer);
  }

  /** Thread questions in order, one conversation each; every other question on its own. */
  static groups(cases: ChatbotCheckupCase[]): Group[] {
    const threads = new Map<string, Group>();
    const groups: Group[] = [];
    for (const item of cases) {
      if (!item.thread) {
        groups.push({ thread: null, cases: [item] });
        continue;
      }
      let group = threads.get(item.thread);
      if (!group) {
        group = { thread: item.thread, cases: [] };
        threads.set(item.thread, group);
        groups.push(group);
      }
      group.cases.push(item);
    }
    return groups;
  }

  private async execute(
    run: ChatbotCheckupRun,
    cases: ChatbotCheckupCase[],
    attempts: number | ((item: ChatbotCheckupCase) => number),
    context: GradeContext = {},
  ): Promise<void> {
    const prompts = await this.prompts();
    const triesOf = (item: ChatbotCheckupCase) =>
      typeof attempts === 'number' ? attempts : attempts(item);
    const work: { group: Group; attempt: number }[] = [];
    const most = Math.max(1, ...cases.map(triesOf));
    for (let attempt = 1; attempt <= most; attempt += 1) {
      for (const group of CheckupService.groups(cases)) {
        // A thread is asked as often as its most-tried question.
        if (attempt <= Math.max(...group.cases.map(triesOf))) {
          work.push({ group, attempt });
        }
      }
    }
    let next = 0;
    const worker = async () => {
      while (next < work.length) {
        const { group, attempt } = work[next++];
        await this.askGroup(run, group, attempt, prompts, context);
      }
    };
    await Promise.all(
      Array.from(
        { length: Math.min(CHECKUP_LIMITS.concurrency, work.length) },
        worker,
      ),
    );
    const totals = await this.totalsFor(run.id);
    await this.runs.save({
      ...run,
      status: 'done' as const,
      phase: 'done' as const,
      asked: run.total,
      done: run.total,
      totals: totals as unknown as Record<string, unknown>,
      finishedAt: new Date(),
    });
    this.logger.info(
      `Checkup run ${run.id} done: ${totals.questions} questions, ${totals.failed} failed, ${totals.hardFails} hard fails`,
    );
  }

  private async askGroup(
    run: ChatbotCheckupRun,
    group: Group,
    attempt: number,
    prompts: Record<string, unknown> | undefined,
    context: GradeContext = {},
  ): Promise<void> {
    const conversationId = `checkup-${run.id.slice(0, 8)}-${group.cases[0].id.slice(0, 8)}-${attempt}`;
    const history: { role: 'user' | 'assistant'; content: string }[] = [];
    for (const item of group.cases) {
      const startedAt = Date.now();
      let tested: ChatbotTestResult | null = null;
      let grade: CheckupGradeResponse | null = null;
      try {
        tested = await this.chatbots.test(run.chatbotId, {
          message: item.question,
          history: [...history],
          conversationId,
        });
        await this.markAsked(run);
        grade = await this.ai.gradeCheckup(
          CheckupService.gradeRequest(item, tested, history, prompts, context),
        );
      } catch (error) {
        this.logger.warn(
          `Checkup question ${item.id} in run ${run.id} could not be graded: ${error instanceof Error ? error.name : 'error'}`,
        );
      }
      await this.results.save(
        this.results.create({
          runId: run.id,
          caseId: item.id,
          attempt,
          reply: tested?.reply ?? '',
          handledBy: tested?.handledBy ?? '',
          outcome: grade?.outcome ?? 'other',
          citations: (tested?.citations ?? []).map((c) => ({
            documentId: String(c.document_id ?? ''),
            title: String(c.document_title ?? ''),
            url: String(c.source_url ?? ''),
          })),
          verdict: grade?.verdict ?? 'error',
          // v1 answered because v2 failed (usually the run's 20 s cap): kept on the result so
          // the numbers can count it, never hidden in the reply time.
          reasons: [
            ...(grade?.reasons ?? ['not_graded']),
            ...(tested?.runtime === AgentRuntimeUsed.V2_FALLBACK
              ? [`v1_fallback:${tested.fallbackReason ?? 'unknown'}`]
              : []),
          ],
          hardFail: grade?.hard_fail ?? false,
          wrongDecline: grade?.wrong_decline ?? false,
          answerPageOffered: grade?.answer_page_offered ?? null,
          searches:
            typeof tested?.retrieval?.searches === 'number'
              ? tested.retrieval.searches
              : null,
          graderVersion: grade?.grader_version ?? '',
          ms: tested?.latencyMs ?? Date.now() - startedAt,
        }),
      );
      if (!tested) await this.markAsked(run);
      await this.runs.increment({ id: run.id }, 'done', 1);
      history.push(
        { role: 'user', content: item.question },
        { role: 'assistant', content: tested?.reply ?? '' },
      );
    }
  }

  /** One more question asked; once every one has been, the run is checking the last answers. */
  private async markAsked(run: ChatbotCheckupRun): Promise<void> {
    await this.runs.increment({ id: run.id }, 'asked', 1);
    await this.runs
      .createQueryBuilder()
      .update()
      .set({ phase: 'checking' })
      .where('id = :id AND asked >= total AND phase = :asking', {
        id: run.id,
        asking: 'asking',
      })
      .execute();
  }

  /**
   * The questions that didn't pass in the latest checkup (chunk 20d-2, "Run only failed"): any
   * that failed, partly passed, needed input or couldn't be checked, and any never asked.
   */
  async notPassed(
    chatbotId: string,
    cases: ChatbotCheckupCase[],
  ): Promise<ChatbotCheckupCase[]> {
    const latest = await this.latestFor(chatbotId);
    if (!latest) return cases;
    const verdicts = new Map<string, string[]>();
    for (const row of latest.results) {
      verdicts.set(row.caseId, [
        ...(verdicts.get(row.caseId) ?? []),
        row.verdict,
      ]);
    }
    return cases.filter(
      (item) => resultOf(verdicts.get(item.id) ?? []) !== 'passed',
    );
  }

  static gradeRequest(
    item: ChatbotCheckupCase,
    tested: ChatbotTestResult,
    history: { role: 'user' | 'assistant'; content: string }[],
    prompts?: Record<string, unknown>,
    context: GradeContext = {},
  ): CheckupGradeRequest {
    const retrieval = (tested.retrieval ?? {}) as Record<string, unknown>;
    return {
      case: {
        id: item.id,
        question: item.question,
        expect: item.expect,
        // The owner's facts, plus what their choice of outcome implies (chunk 20d-2).
        facts: gradedFacts(item),
        must_not: item.mustNot,
        also_ok: item.alsoOk,
        hard_fail: item.hardFail,
        source: item.source,
      },
      observed: {
        // Graded as the bot page shows it: the page lists sources itself, so Preview's
        // plain-text "Sources:" footer isn't part of what the assistant said.
        reply: withoutSourcesFooter(tested.reply),
        handled_by: tested.handledBy,
        turn_type: tested.turnType ?? '',
        citations: tested.citations.map((c) => ({
          chunk_id: String(c.chunk_id ?? ''),
          document_id: String(c.document_id ?? ''),
          document_title: String(c.document_title ?? ''),
          source_url: String(c.source_url ?? ''),
        })),
        passage_document_ids: Array.isArray(retrieval.passage_document_ids)
          ? (retrieval.passage_document_ids as unknown[]).map(String)
          : [],
        passage_chunk_ids: Array.isArray(retrieval.passage_chunk_ids)
          ? (retrieval.passage_chunk_ids as unknown[]).map(String)
          : [],
        would_file_unanswered: Boolean(tested.wouldFileUnanswered),
        decline_text: context.declineText ?? '',
        about: context.about ?? '',
        history,
      },
      judge: true,
      ...(prompts ? { prompts } : {}),
    };
  }

  private async prompts(): Promise<Record<string, unknown> | undefined> {
    try {
      return (await this.ai.getPromptOverrides([
        ...CHECKUP_PROMPT_CODES,
      ])) as Record<string, unknown>;
    } catch {
      return undefined; // ally-ai falls back to its default prompt text
    }
  }

  /**
   * A run's results. "Run only failed" asks some questions again: the others keep their results
   * from the checkup before it, so the run still reads as the whole checkup (same stats).
   */
  private async rowsOf(runId: string): Promise<ChatbotCheckupResult[]> {
    const run = await this.runs.findOne({ where: { id: runId } });
    const rows = await this.results.find({
      where: { runId },
      order: { createdAt: 'ASC' },
    });
    if (!run || run.only !== 'failed') return rows;
    const base = await this.runs.findOne({
      where: {
        chatbotId: run.chatbotId,
        suite: IsNull(),
        status: 'done',
        only: 'all',
        trigger: In(['onboarding', 'manual', 'after_change']),
        startedAt: LessThan(run.startedAt),
      },
      order: { startedAt: 'DESC' },
    });
    if (!base) return rows;
    const asked = new Set(rows.map((r) => r.caseId));
    const kept = (
      await this.results.find({
        where: { runId: base.id },
        order: { createdAt: 'ASC' },
      })
    ).filter((r) => !asked.has(r.caseId));
    return [...kept, ...rows];
  }

  async totalsFor(runId: string) {
    const rows = await this.rowsOf(runId);
    const cases = await this.cases.find({
      where: { id: In([...new Set(rows.map((r) => r.caseId))]) },
    });
    const byId = new Map(cases.map((c) => [c.id, c]));
    const inputs: StatInput[] = rows.flatMap((row) => {
      const item = byId.get(row.caseId);
      if (!item) return [];
      return [
        {
          caseId: row.caseId,
          expect: item.expect,
          hardFailCase: item.hardFail,
          tier: item.tier,
          verdict: row.verdict,
          outcome: row.outcome,
          cited: row.citations.length > 0,
          hardFail: row.hardFail,
          wrongDecline: row.wrongDecline,
          fallback: row.reasons.some((r) => r.startsWith('v1_fallback')),
          ms: row.ms,
        },
      ];
    });
    return checkupTotals(inputs);
  }

  /**
   * Asks `caseIds` again now and waits for the grades (the publish gate's safety recheck). Not
   * counted against the owner's daily runs.
   */
  async askNow(
    chatbotId: string,
    caseIds: string[],
    draftId: string | null,
    trigger: 'onboarding' | 'try' = 'onboarding',
  ): Promise<CheckupResultView[]> {
    const cases = await this.cases.find({
      where: { chatbotId, id: In(caseIds), deletedAt: IsNull() },
    });
    const run = await this.runs.save(
      this.runs.create({
        chatbotId,
        draftId,
        trigger,
        status: 'running',
        total: cases.length,
        done: 0,
        asked: 0,
        phase: 'asking',
        only: trigger === 'try' ? 'one' : 'all',
        startedBy: Number(ExecutionManager.getUserId() ?? 0) || null,
      }),
    );
    await this.execute(run, cases, 1);
    return (await this.viewOf(run.id)).results;
  }

  /** The latest finished-or-running run of the assistant's own questions, for a draft or any. */
  async latestFor(
    chatbotId: string,
    draftId?: string,
  ): Promise<CheckupRunView | null> {
    const run = await this.runs.findOne({
      where: {
        chatbotId,
        suite: IsNull(),
        trigger: In(['onboarding', 'manual', 'after_change']),
        ...(draftId ? { draftId } : {}),
      },
      order: { startedAt: 'DESC' },
    });
    return run ? this.viewOf(run.id) : null;
  }

  /** The Checkup section: the latest run, the trend of finished runs, and the wording it needs. */
  async view(chatbotId: string, fallback: string, audience: string) {
    await this.access.assert(chatbotId, ChatbotMemberRole.VIEWER);
    const latest = await this.latestFor(chatbotId);
    const done = await this.runs.find({
      where: {
        chatbotId,
        suite: IsNull(),
        status: 'done',
        trigger: In(['onboarding', 'manual', 'after_change']),
      },
      order: { startedAt: 'DESC' },
      take: 7,
    });
    const trend = done.reverse().map((run) => {
      const accuracy = (
        run.totals as { accuracy?: { passed: number; total: number } }
      ).accuracy;
      return {
        at: (run.finishedAt ?? run.startedAt).toISOString(),
        accuracy: accuracy?.total
          ? Math.round((accuracy.passed / accuracy.total) * 100)
          : 0,
      };
    });
    // Before and after (chunk 20d-2): the finished checkup before the latest, by the same measure.
    const accuracyOf = (run?: ChatbotCheckupRun) =>
      (
        run?.totals as
          | { accuracy?: { passed: number; total: number } }
          | undefined
      )?.accuracy ?? null;
    const compare =
      done.length >= 2 && latest?.run.status === 'done'
        ? {
            before: accuracyOf(done[done.length - 2]),
            after: accuracyOf(done[done.length - 1]),
          }
        : null;
    return { latest, trend, fallback, audience, compare };
  }

  private async viewOf(runId: string): Promise<CheckupRunView> {
    const run = await this.runs.findOneOrFail({ where: { id: runId } });
    const results = await this.rowsOf(runId);
    const cases = await this.cases.find({
      where: { id: In([...new Set(results.map((r) => r.caseId))]) },
    });
    const byId = new Map(cases.map((c) => [c.id, c]));
    return {
      run: {
        id: run.id,
        status: run.status,
        total: run.total,
        done: run.done,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt ?? null,
        phase: run.phase,
        asked: run.asked,
        only: run.only,
        trigger: run.trigger,
      },
      totals:
        run.status === 'done'
          ? run.totals
          : results.length
            ? ((await this.totalsFor(run.id)) as unknown as Record<
                string,
                unknown
              >)
            : {},
      results: results.flatMap((row) => {
        const item = byId.get(row.caseId);
        if (!item) return [];
        return [
          {
            caseId: item.id,
            question: item.question,
            expect: item.expect,
            verdict: row.verdict,
            outcome: row.outcome,
            reasons: row.reasons,
            hardFail: row.hardFail,
            safety: item.origin === 'platform' && Boolean(item.packId),
            source: item.source,
            reply: row.reply,
            attempt: row.attempt,
            tier: item.tier,
            origin: item.origin,
            citations: row.citations,
            ms: row.ms,
          },
        ];
      }),
    };
  }

  async getRun(chatbotId: string, runId: string) {
    await this.access.assert(chatbotId, ChatbotMemberRole.VIEWER);
    const run = await this.runs.findOne({ where: { id: runId, chatbotId } });
    if (!run) throw new NotFoundException('Checkup run not found');
    const results = await this.results.find({
      where: { runId },
      order: { createdAt: 'ASC' },
    });
    const cases = await this.cases.find({
      where: { id: In([...new Set(results.map((r) => r.caseId))]) },
    });
    const byId = new Map(cases.map((c) => [c.id, c]));
    return {
      run,
      totals: run.status === 'done' ? run.totals : await this.totalsFor(run.id),
      results: results.map((row) => ({
        ...row,
        question: byId.get(row.caseId)?.question ?? '',
        expect: byId.get(row.caseId)?.expect ?? null,
        externalId: byId.get(row.caseId)?.externalId ?? null,
        tier: byId.get(row.caseId)?.tier ?? null,
      })),
    };
  }
}
