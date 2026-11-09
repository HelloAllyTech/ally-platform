import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThan, Repository } from 'typeorm';
import type {
  CheckupGradeRequest,
  CheckupGradeResponse,
} from '../../ai/dto/checkup.dto';
import { AiService } from '../../ai/service/ai.service';
import { ChatbotMemberRole } from '../../chatbot/enum/chatbot.enum';
import { ChatbotAccessService } from '../../chatbot/service/chatbot-access.service';
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

/** The plain-text sources list a channel without a sources view gets (reply-composer.ts). */
export const withoutSourcesFooter = (reply: string): string =>
  reply.replace(/\n\nSources:\n[\s\S]*$/, '');

export const CHECKUP_PROMPT_CODES = ['ally_ai_checkup_judge'] as const;

export const CHECKUP_LIMITS = {
  /** Runs an owner can start per assistant per day (evals don't count; they're admin-only). */
  runsPerDay: 5,
  /** Questions asked per run. */
  questionsPerRun: 25,
  /** Questions asked at once. */
  concurrency: 4,
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
  attempts?: number;
  draftId?: string | null;
}

type Group = { thread: string | null; cases: ChatbotCheckupCase[] };

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

  async start(
    chatbotId: string,
    options: StartRun,
  ): Promise<ChatbotCheckupRun> {
    await this.access.assert(chatbotId, ChatbotMemberRole.EDITOR);
    const attempts = Math.min(
      Math.max(options.attempts ?? 1, 1),
      CHECKUP_LIMITS.maxAttempts,
    );
    if (options.trigger === 'eval' || attempts > 1) {
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
        ...(options.suite ? { suite: options.suite } : {}),
      },
      order: { position: 'ASC', createdAt: 'ASC' },
    });
    const limit =
      options.trigger === 'eval'
        ? cases.length
        : CHECKUP_LIMITS.questionsPerRun;
    const asked = cases.slice(0, limit);
    if (!asked.length) throw new BadRequestException('no_checkup_questions');

    const run = await this.runs.save(
      this.runs.create({
        chatbotId,
        draftId: options.draftId ?? null,
        trigger: options.trigger,
        suite: options.suite ?? null,
        status: 'running',
        total: asked.length * attempts,
        done: 0,
        startedBy: Number(ExecutionManager.getUserId() ?? 0) || null,
      }),
    );
    // Not awaited: the caller polls the run. The request's user context carries into the work.
    void this.execute(run, asked, attempts).catch(async (error: unknown) => {
      this.logger.error(
        `Checkup run ${run.id} failed: ${error instanceof Error ? error.name : 'error'}`,
      );
      await this.runs.update(
        { id: run.id },
        { status: 'failed', finishedAt: new Date() },
      );
    });
    return run;
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
    attempts: number,
  ): Promise<void> {
    const prompts = await this.prompts();
    const work: { group: Group; attempt: number }[] = [];
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      for (const group of CheckupService.groups(cases))
        work.push({ group, attempt });
    }
    let next = 0;
    const worker = async () => {
      while (next < work.length) {
        const { group, attempt } = work[next++];
        await this.askGroup(run, group, attempt, prompts);
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
        grade = await this.ai.gradeCheckup(
          CheckupService.gradeRequest(item, tested, history, prompts),
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
          reasons: grade?.reasons ?? ['not_graded'],
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
      await this.runs.increment({ id: run.id }, 'done', 1);
      history.push(
        { role: 'user', content: item.question },
        { role: 'assistant', content: tested?.reply ?? '' },
      );
    }
  }

  static gradeRequest(
    item: ChatbotCheckupCase,
    tested: ChatbotTestResult,
    history: { role: 'user' | 'assistant'; content: string }[],
    prompts?: Record<string, unknown>,
  ): CheckupGradeRequest {
    const retrieval = (tested.retrieval ?? {}) as Record<string, unknown>;
    return {
      case: {
        id: item.id,
        question: item.question,
        expect: item.expect,
        facts: item.facts,
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
        would_file_unanswered: Boolean(tested.wouldFileUnanswered),
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

  async totalsFor(runId: string) {
    const rows = await this.results.find({ where: { runId } });
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
          ms: row.ms,
        },
      ];
    });
    return checkupTotals(inputs);
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
