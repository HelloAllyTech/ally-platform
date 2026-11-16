import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { AiService } from '../../ai/service/ai.service';
import { ChatbotMemberRole } from '../../chatbot/enum/chatbot.enum';
import { ChatbotAccessService } from '../../chatbot/service/chatbot-access.service';
import { LoggerService } from '../../logger/logger.service';
import { ChatbotCheckupCase } from '../entity/chatbot-checkup.entity';
import type { BotDraftEntity } from '../entity/bot-draft.entity';
import { packFor } from '../safety-pack/safety-packs';
import { BotDraftPublishService } from '../service/bot-draft-publish.service';
import { conversation } from '../service/bot-draft-session.service';
import { BotDraftService } from '../service/bot-draft.service';
import {
  answerCases,
  askableFacts,
  gapCases,
  outOfScopeCases,
  safetyCases,
} from './checkup-generation';
import { CheckupService } from './checkup.service';

/** Answer questions written per checkup (the rest come from gaps, the pack and the platform). */
const ANSWER_QUESTIONS = 12;

/** "Suggest more questions" offers up to this many at a time (chunk 20d-2). */
const SUGGESTIONS = 8;

/** Sent with each request for questions, so an edit in Manage Prompts takes effect (chunk H0). */
const QUESTIONS_PROMPT_CODES = ['ally_ai_checkup_questions'] as const;

const normalised = (question: string) =>
  question
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** A kept suggestion's source, as it was offered (a page or the owner's words). */
function sourceOf(raw: unknown): ChatbotCheckupCase['source'] {
  const value = (raw ?? {}) as Record<string, unknown>;
  const kind = ['page', 'document', 'owner'].includes(String(value.kind))
    ? (String(value.kind) as 'page' | 'document' | 'owner')
    : 'owner';
  return {
    kind,
    title: String(value.title ?? '').slice(0, 200),
    ...(typeof value.url === 'string' ? { url: value.url.slice(0, 2000) } : {}),
  } as ChatbotCheckupCase['source'];
}

/**
 * The checkup for an assistant made by onboarding (chunk 20a-2): its questions written from what
 * we learned, a run on the draft (configured on its DRAFT chatbot exactly as publish would), the
 * owner's answers to gaps, and the gate publish checks.
 */
@Injectable()
export class DraftCheckupService {
  private readonly logger = LoggerService.getInstance(DraftCheckupService.name);

  constructor(
    private readonly drafts: BotDraftService,
    private readonly publisher: BotDraftPublishService,
    private readonly checkup: CheckupService,
    private readonly ai: AiService,
    private readonly access: ChatbotAccessService,
    @InjectRepository(ChatbotCheckupCase)
    private readonly cases: Repository<ChatbotCheckupCase>,
    private readonly events: EventEmitter2,
  ) {}

  /** Writes the questions (keeping the owner's and the platform's) and starts a run. */
  async runForDraft(draftId: string) {
    const draft = await this.drafts.get(draftId);
    if (!draft.chatbotId) throw new ConflictException('not_ready');
    await this.access.assert(draft.chatbotId, ChatbotMemberRole.EDITOR);
    await this.publisher.stage(draft);
    await this.generate(draft);
    const run = await this.checkup.start(draft.chatbotId, {
      trigger: 'onboarding',
      draftId: draft.id,
    });
    return { chatbotId: draft.chatbotId, run };
  }

  async generate(draft: BotDraftEntity): Promise<void> {
    const facts = askableFacts(draft.learned?.facts ?? []);
    const state = conversation(draft);
    let written: { question: string; fact_ids: string[] }[] = [];
    if (facts.length) {
      try {
        const prompts = await this.prompts();
        const out = await this.ai.writeCheckupQuestions({
          business: draft.draftConfig.name,
          audience: audienceOf(state.values),
          language: draft.draftConfig.languages[0] ?? 'en',
          count: ANSWER_QUESTIONS,
          facts: facts.map((f) => ({
            id: f.id,
            section: f.section,
            text: f.correction?.text ?? f.text,
          })),
          ...(prompts ? { prompts } : {}),
        });
        written = out.questions;
      } catch (error) {
        // The platform's and the pack's questions still run; the owner sees fewer.
        this.logger.warn(
          `Checkup questions for draft ${draft.id} couldn't be written: ${error instanceof Error ? error.name : 'error'}`,
        );
      }
    }
    await this.checkup.generate(draft.chatbotId!, [
      ...answerCases(written, facts, draft.crawl?.pages ?? []),
      ...gapCases(state.gaps, state.values),
      ...outOfScopeCases(),
      ...safetyCases(packFor(draft.draftConfig.safetyPackId)),
    ]);
  }

  /** The Checkup section, with where it points people when it doesn't know and who asks. */
  async view(chatbotId: string) {
    const { chatbot } = await this.access.assert(
      chatbotId,
      ChatbotMemberRole.VIEWER,
    );
    const draft = await this.drafts.findByChatbot(chatbotId);
    const declineText = draft?.draftConfig.declineText || '';
    void chatbot;
    return this.checkup.view(
      chatbotId,
      fallbackOf(declineText),
      draft ? audienceOf(conversation(draft).values) : 'clients',
    );
  }

  /** "Add answer": into the Owner notes, and the question becomes one it should answer. */
  async answerGap(chatbotId: string, caseId: string, text: string) {
    const { draft, item } = await this.gapCase(chatbotId, caseId);
    await this.addNote(draft, `${item.question} ${text.trim()}`);
    await this.cases.update(
      { id: item.id },
      {
        expect: 'answer',
        facts: [text.trim()],
        source: { kind: 'owner', title: 'From you' },
        origin: 'owner',
        confirmed: true,
        tier: 'must_pass',
      },
    );
    return { ok: true as const };
  }

  /**
   * The owner's answer to a real question (chunk Q2a, the Overview's "Answer it" and "Correct
   * this"): written to Owner notes, kept as a confirmed checkup question with the answer as its
   * fact, and checked in the next checkup. The caller has checked the owner may edit.
   */
  async addOwnerAnswer(
    chatbotId: string,
    question: string,
    text: string,
    options: {
      addToCheckup?: boolean;
      addedFrom?: 'unanswered' | 'thumbs_down';
    } = {},
  ) {
    const answer = text.trim();
    if (!answer) throw new BadRequestException('Write the answer first.');
    const draft = await this.drafts.findByChatbot(chatbotId);
    if (!draft) throw new NotFoundException('That assistant has no setup.');
    await this.addNote(draft, `${question.trim()} ${answer}`);
    // "Also add to checkup" (chunk 20d-2), ticked by default: as before, unless unticked.
    if (options.addToCheckup === false) return { ok: true as const };
    await this.cases.save(
      this.cases.create({
        chatbotId,
        question: question.trim().slice(0, 500),
        expect: 'answer',
        facts: [answer],
        source: { kind: 'owner', title: 'From you' },
        origin: 'owner',
        outcome: 'answer',
        addedFrom: options.addedFrom ?? null,
        confirmed: true,
        tier: 'must_pass',
      }),
    );
    this.checkup.scheduleAfterChange(chatbotId);
    return { ok: true as const };
  }

  /**
   * "Suggest more questions" (chunk 20d-2): new questions written from what we learned, none the
   * checkup already asks. Nothing is added: the owner ticks the ones to keep (`keepSuggestions`).
   */
  async suggest(chatbotId: string) {
    await this.access.assert(chatbotId, ChatbotMemberRole.EDITOR);
    const draft = await this.drafts.findByChatbot(chatbotId);
    const facts = askableFacts(draft?.learned?.facts ?? []);
    if (!draft || !facts.length) return { suggestions: [] };
    const existing = await this.cases.find({
      where: { chatbotId, deletedAt: IsNull() },
    });
    const asked = new Set(existing.map((c) => normalised(c.question)));
    const state = conversation(draft);
    let written: { question: string; fact_ids: string[] }[] = [];
    try {
      const prompts = await this.prompts();
      const out = await this.ai.suggestCheckupQuestions({
        business: draft.draftConfig.name,
        audience: audienceOf(state.values),
        language: draft.draftConfig.languages[0] ?? 'en',
        count: SUGGESTIONS,
        facts: facts.map((f) => ({
          id: f.id,
          section: f.section,
          text: f.correction?.text ?? f.text,
        })),
        exclude: existing.map((c) => c.question).slice(0, 60),
        ...(prompts ? { prompts } : {}),
      });
      written = out.questions;
    } catch (error) {
      this.logger.warn(
        `Suggested checkup questions for ${chatbotId} couldn't be written: ${error instanceof Error ? error.name : 'error'}`,
      );
      return { suggestions: [] };
    }
    const suggestions = answerCases(written, facts, draft.crawl?.pages ?? [])
      .filter((p) => !asked.has(normalised(p.question)))
      .map((p) => ({ question: p.question, facts: p.facts, source: p.source }));
    return { suggestions };
  }

  private async prompts(): Promise<Record<string, unknown> | undefined> {
    try {
      return (await this.ai.getPromptOverrides([
        ...QUESTIONS_PROMPT_CODES,
      ])) as Record<string, unknown>;
    } catch {
      return undefined; // ally-ai falls back to its default prompt text
    }
  }

  /** The suggestions the owner ticked, kept as questions Ally wrote (confirmed, so kept). */
  async keepSuggestions(
    chatbotId: string,
    kept: { question: string; facts: string[]; source?: unknown }[],
  ) {
    await this.access.assert(chatbotId, ChatbotMemberRole.EDITOR);
    const existing = await this.cases.find({
      where: { chatbotId, deletedAt: IsNull() },
    });
    const asked = new Set(existing.map((c) => normalised(c.question)));
    const rows = kept
      .filter((k) => k.question?.trim() && !asked.has(normalised(k.question)))
      .slice(0, SUGGESTIONS)
      .map((k) =>
        this.cases.create({
          chatbotId,
          question: k.question.trim().slice(0, 500),
          expect: 'answer',
          outcome: 'answer',
          facts: (k.facts ?? []).map(String).slice(0, 12),
          source: sourceOf(k.source),
          origin: 'generated',
          confirmed: true,
          status: 'active',
          tier: 'must_pass',
        }),
      );
    if (rows.length) await this.cases.save(rows);
    this.checkup.scheduleAfterChange(chatbotId);
    return { added: rows.length };
  }

  /** "We don't offer this": noted, and the question stays one it should decline. */
  async notOffered(chatbotId: string, caseId: string) {
    const { draft, item } = await this.gapCase(chatbotId, caseId);
    const title = item.source?.title || item.question;
    await this.addNote(
      draft,
      `We don't offer ${title.replace(/^your /, 'our ')}.`,
    );
    await this.cases.update(
      { id: item.id },
      {
        source: { kind: 'owner', title },
        origin: 'owner',
        confirmed: true,
      },
    );
    return { ok: true as const };
  }

  /**
   * Publishing needs a finished checkup on this draft with no unsourced answer and every safety
   * question passed. A safety question that failed is asked once more before blocking; if it
   * still fails, the owner is asked to try again later and the Ally team is alerted.
   */
  async assertCanPublish(draft: BotDraftEntity): Promise<void> {
    const latest = await this.checkup.latestFor(draft.chatbotId!, draft.id);
    if (!latest || latest.run.status !== 'done') {
      throw new ConflictException({
        errorCode: 'checkup_needed',
        message: 'Run the checkup before you publish.',
      });
    }
    if (latest.results.some((r) => r.reasons.includes('uncited_answer'))) {
      throw new ConflictException({
        errorCode: 'checkup_unsourced',
        message:
          'One answer had no source. Look at it in the checkup, then run it again.',
      });
    }
    const failedSafety = latest.results.filter(
      (r) => r.safety && r.verdict !== 'pass',
    );
    if (!failedSafety.length) return;
    const again = await this.checkup.askNow(
      draft.chatbotId!,
      failedSafety.map((r) => r.caseId),
      draft.id,
    );
    if (again.every((r) => r.verdict === 'pass')) return;
    this.events.emit('exception', {
      statusCode: 409,
      timestamp: new Date().toISOString(),
      path: `/api/v1/bot-drafts/${draft.id}/publish`,
      message: `Checkup safety question failed twice for chatbot ${draft.chatbotId}: publishing is held. Look at the run's results.`,
      type: 'CHECKUP SAFETY',
    });
    throw new ConflictException({
      errorCode: 'safety_recheck',
      message:
        "We're double-checking a safety answer. Try again in a few minutes.",
    });
  }

  private async gapCase(chatbotId: string, caseId: string) {
    await this.access.assert(chatbotId, ChatbotMemberRole.EDITOR);
    const item = await this.cases.findOne({ where: { id: caseId, chatbotId } });
    if (!item || item.origin === 'platform' || item.origin === 'suite') {
      throw new NotFoundException('That question was not found.');
    }
    const draft = await this.drafts.findByChatbot(chatbotId);
    if (!draft) throw new NotFoundException('That assistant has no setup.');
    return { draft, item };
  }

  private async addNote(draft: BotDraftEntity, line: string): Promise<void> {
    const ownerNotes = [draft.draftConfig.ownerNotes?.trim(), line]
      .filter(Boolean)
      .join('\n');
    const saved = await this.drafts.update(draft, {
      draftConfig: { ...draft.draftConfig, ownerNotes },
    });
    await this.publisher.ownerNotes(saved, { ownerNotes });
  }
}

/** The contact in the owner's decline wording ("+91 20 0000 4400"), else "your team". */
export function fallbackOf(declineText: string): string {
  const contact = declineText.match(
    /[\w.+-]+@[\w-]+\.[\w.]+|\+?\d[\d\s-]{6,}\d/,
  );
  return contact ? contact[0].trim() : 'your team';
}

/** The builder's audience answer, as the deck's {clients}. */
export function audienceOf(values: Record<string, string>): string {
  const answer = (values.audience ?? '').toLowerCase();
  if (answer.includes('team')) return 'team';
  return 'clients';
}
