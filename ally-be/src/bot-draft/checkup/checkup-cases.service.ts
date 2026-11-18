import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, MoreThan, Repository } from 'typeorm';
import { ChatbotMemberRole } from '../../chatbot/enum/chatbot.enum';
import { ChatbotAccessService } from '../../chatbot/service/chatbot-access.service';
import { ExecutionManager } from '../../common/execution/execution-manager';
import {
  ChatbotCheckupCase,
  ChatbotCheckupResult,
  ChatbotCheckupRun,
  CheckupAddedFrom,
  CheckupOutcomeChoice,
} from '../entity/chatbot-checkup.entity';
import type { BotDraftEntity } from '../entity/bot-draft.entity';
import { STALE_MESSAGE } from '../home/assistant-home.service';
import {
  applyEdit,
  badgeOf,
  CaseEdit,
  CaseLocked,
  caseVersion,
  EXPECT_OF,
  isSafety,
  LOCKED,
  outcomeOf,
  resultOf,
} from './checkup-cases';
import { CheckupService } from './checkup.service';

/** "Try this one" runs a question on its own, about 10 s; this many a day per assistant. */
export const TRY_PER_DAY = 30;

/** How many past results each question shows. */
const HISTORY = 5;

export interface NewCase {
  question: string;
  outcome: CheckupOutcomeChoice;
  facts?: string[];
  mustNot?: string[];
  mustPass?: boolean;
  language?: string | null;
  addedFrom?: CheckupAddedFrom | null;
}

/** A question as the owner's list shows it (chunk 20d-2). */
export interface CaseView {
  id: string;
  question: string;
  outcome: CheckupOutcomeChoice | null;
  expect: ChatbotCheckupCase['expect'];
  facts: string[];
  mustNot: string[];
  mustPass: boolean;
  language: string | null;
  active: boolean;
  safety: boolean;
  /** Who wrote it: Written by Ally, Added by you, From a chat. */
  badge: 'ally' | 'you' | 'chat';
  addedFrom: CheckupAddedFrom | null;
  source: ChatbotCheckupCase['source'];
  version: string;
  /** Its last runs, newest first: the result (passed, partly, failed…) of each run. */
  history: { runId: string; at: string; result: ReturnType<typeof resultOf> }[];
}

/**
 * The owner's control over the Checkup (chunk 20d-2): every question can be read, added, edited,
 * turned off, deleted with Undo, and tried on its own. Safety questions can only be added to.
 * Each edit carries the version it was based on (409 with the current question when stale), and
 * nothing here grades: questions go through the same runner and the same grader as before.
 */
@Injectable()
export class CheckupCasesService {
  constructor(
    @InjectRepository(ChatbotCheckupCase)
    private readonly cases: Repository<ChatbotCheckupCase>,
    @InjectRepository(ChatbotCheckupRun)
    private readonly runs: Repository<ChatbotCheckupRun>,
    @InjectRepository(ChatbotCheckupResult)
    private readonly results: Repository<ChatbotCheckupResult>,
    private readonly access: ChatbotAccessService,
    private readonly checkup: CheckupService,
  ) {}

  /** The assistant's own questions (not eval suites), with their last results. */
  async list(chatbotId: string): Promise<{ cases: CaseView[] }> {
    await this.access.assert(chatbotId, ChatbotMemberRole.VIEWER);
    const rows = await this.cases.find({
      where: { chatbotId, suite: IsNull(), deletedAt: IsNull() },
      order: { position: 'ASC', createdAt: 'ASC' },
    });
    const history = await this.historyOf(rows.map((r) => r.id));
    return { cases: rows.map((row) => this.view(row, history.get(row.id))) };
  }

  async create(chatbotId: string, input: NewCase): Promise<CaseView> {
    await this.access.assert(chatbotId, ChatbotMemberRole.EDITOR);
    const question = input.question?.trim();
    if (!question) throw invalid('Write the question.');
    const edit = locked(() =>
      applyEdit(
        this.cases.create({ origin: 'owner', facts: [], mustNot: [] }),
        {
          question,
          outcome: input.outcome,
          facts: input.facts,
          mustNot: input.mustNot,
          mustPass: input.mustPass ?? true,
          language: input.language ?? null,
        },
      ),
    );
    const position = (await this.cases.maximum('position', { chatbotId })) ?? 0;
    const saved = await this.cases.save(
      this.cases.create({
        chatbotId,
        expect: EXPECT_OF[input.outcome],
        source: { kind: 'owner', title: 'From you' },
        origin: 'owner',
        status: 'active',
        hardFail: false,
        tier: 'must_pass',
        facts: [],
        mustNot: [],
        alsoOk: [],
        ...edit,
        addedFrom: input.addedFrom ?? null,
        confirmed: true,
        position: position + 1,
        createdBy: Number(ExecutionManager.getUserId() ?? 0) || null,
      }),
    );
    this.checkup.scheduleAfterChange(chatbotId);
    return this.view(saved);
  }

  async edit(
    chatbotId: string,
    caseId: string,
    edit: CaseEdit & { version: string },
  ): Promise<CaseView> {
    await this.access.assert(chatbotId, ChatbotMemberRole.EDITOR);
    const item = await this.own(chatbotId, caseId);
    this.fresh(item, edit.version);
    const changes = locked(() => applyEdit(item, edit));
    const saved = await this.cases.save({ ...item, ...changes });
    this.checkup.scheduleAfterChange(chatbotId);
    return this.view(saved, (await this.historyOf([saved.id])).get(saved.id));
  }

  /** Deleted, not erased: Undo (`restore`) brings it back with its results. */
  async remove(chatbotId: string, caseId: string, version: string) {
    await this.access.assert(chatbotId, ChatbotMemberRole.EDITOR);
    const item = await this.own(chatbotId, caseId);
    this.fresh(item, version);
    if (isSafety(item)) throw lockedError(LOCKED);
    await this.cases.update({ id: item.id }, { deletedAt: new Date() });
    return { ok: true as const };
  }

  async restore(chatbotId: string, caseId: string): Promise<CaseView> {
    await this.access.assert(chatbotId, ChatbotMemberRole.EDITOR);
    const item = await this.cases.findOne({ where: { id: caseId, chatbotId } });
    if (!item) throw new NotFoundException('That question is no longer there.');
    await this.cases.update({ id: item.id }, { deletedAt: null });
    return this.view({ ...item, deletedAt: null });
  }

  /** "Try this one": asks one question now and returns its result (about 10 s). */
  async tryOne(chatbotId: string, caseId: string) {
    await this.access.assert(chatbotId, ChatbotMemberRole.EDITOR);
    const item = await this.own(chatbotId, caseId);
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const today = await this.runs.count({
      where: { chatbotId, trigger: 'try', startedAt: MoreThan(since) },
    });
    if (today >= TRY_PER_DAY) {
      throw new HttpException(
        { code: 'try_limit', message: 'try_limit' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const [result] = await this.checkup.askNow(
      chatbotId,
      [item.id],
      null,
      'try',
    );
    return { result: result ?? null };
  }

  /**
   * An owner-added Must pass question that failed in the latest checkup (chunk 20d-2): publishing
   * asks before going live, unless the owner confirmed. Safety questions and unsourced answers are
   * the publish gate's own hard blocks, unchanged.
   */
  async assertMustPassConfirmed(
    draft: BotDraftEntity,
    confirmed: boolean,
  ): Promise<void> {
    if (confirmed || !draft.chatbotId) return;
    const latest = await this.checkup.latestFor(draft.chatbotId, draft.id);
    if (!latest || latest.run.status !== 'done') return;
    const verdicts = new Map<string, string[]>();
    for (const row of latest.results) {
      if (row.origin !== 'owner' || row.tier !== 'must_pass') continue;
      verdicts.set(row.caseId, [
        ...(verdicts.get(row.caseId) ?? []),
        row.verdict,
      ]);
    }
    const failed = latest.results.filter(
      (row, index, all) =>
        verdicts.has(row.caseId) &&
        all.findIndex((r) => r.caseId === row.caseId) === index &&
        ['failed', 'partly'].includes(resultOf(verdicts.get(row.caseId)!)),
    );
    if (!failed.length) return;
    throw new ConflictException({
      errorCode: 'must_pass_failed',
      message: 'This question you marked Must pass failed. Go live anyway?',
      details: {
        questions: failed.map((r) => ({ id: r.caseId, question: r.question })),
      },
    });
  }

  private async own(chatbotId: string, caseId: string) {
    const item = await this.cases.findOne({
      where: { id: caseId, chatbotId, suite: IsNull(), deletedAt: IsNull() },
    });
    if (!item) throw new NotFoundException('That question is no longer there.');
    return item;
  }

  private fresh(item: ChatbotCheckupCase, version: string) {
    if (caseVersion(item) !== version) {
      throw new ConflictException({
        errorCode: 'stale',
        message: STALE_MESSAGE,
        details: { case: this.view(item) },
      });
    }
  }

  private async historyOf(caseIds: string[]) {
    const out = new Map<string, CaseView['history']>();
    if (!caseIds.length) return out;
    const rows = await this.results.find({
      where: { caseId: In(caseIds) },
      order: { createdAt: 'DESC' },
      take: caseIds.length * HISTORY * 3,
    });
    const runIds = [...new Set(rows.map((r) => r.runId))];
    const runs = runIds.length
      ? await this.runs.find({ where: { id: In(runIds) } })
      : [];
    const runAt = new Map(runs.map((r) => [r.id, r]));
    const byCase = new Map<string, Map<string, string[]>>();
    for (const row of rows) {
      const perRun = byCase.get(row.caseId) ?? new Map<string, string[]>();
      perRun.set(row.runId, [...(perRun.get(row.runId) ?? []), row.verdict]);
      byCase.set(row.caseId, perRun);
    }
    for (const [caseId, perRun] of byCase) {
      out.set(
        caseId,
        [...perRun.entries()].slice(0, HISTORY).map(([runId, verdicts]) => ({
          runId,
          at: (runAt.get(runId)?.startedAt ?? new Date()).toISOString(),
          result: resultOf(verdicts),
        })),
      );
    }
    return out;
  }

  private view(
    item: ChatbotCheckupCase,
    history: CaseView['history'] = [],
  ): CaseView {
    return {
      id: item.id,
      question: item.question,
      outcome: outcomeOf(item),
      expect: item.expect,
      facts: item.facts ?? [],
      mustNot: item.mustNot ?? [],
      mustPass: item.tier === 'must_pass',
      language: item.language ?? null,
      active: item.status === 'active',
      safety: isSafety(item),
      badge: badgeOf(item),
      addedFrom: item.addedFrom ?? null,
      source: item.source,
      version: caseVersion(item),
      history,
    };
  }
}

function invalid(message: string) {
  return new BadRequestException({ errorCode: 'invalid_value', message });
}

function lockedError(message: string) {
  return new BadRequestException({ errorCode: 'safety_locked', message });
}

function locked<T>(run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof CaseLocked) {
      throw error.message === 'Write the question.'
        ? invalid(error.message)
        : lockedError(error.message);
    }
    throw error;
  }
}
