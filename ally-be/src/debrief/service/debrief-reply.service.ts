import { Injectable, Optional } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Observable, ReplaySubject, startWith } from 'rxjs';
import { Repository } from 'typeorm';
import {
  AiChatService,
  SseMessageEvent,
} from '../../ai-chat/service/ai-chat.service';
import { LlmMessage } from '../../ai-chat/interface/llm-provider.interface';
import { LlmProviderFactory } from '../../ai-chat/provider/llm-provider.factory';
import { LlmUsageService } from '../../analytics/service/llm-usage.service';
import { DEBRIEF_REFLECTION_CHECK_SYSTEM } from '../../prompt/contracts/prompt-contracts';
import { renderPrompt } from '../../prompt/contracts/define-prompt';
import { matchFirstPersonRisk } from '../../common/safety/first-person-risk.matcher';
import { GuideCrisisService } from '../../guide/safety/guide-crisis.service';
import { ScenarioSessionChat } from '../../learn/entity/scenario-session-chat.entity';
import { ScenarioSessionChatMessage } from '../../learn/entity/scenario-session-chat-message.entity';
import { LlmTask } from '../../learn/enum/llm-task.enum';
import {
  DEBRIEF_MIN_SUBSTANTIVE_REPLIES,
  DebriefEngagementEvent,
  DebriefThreadQualifiedEventParams,
  isGenuineReflection,
  isSubstantiveDebriefReply,
} from '../../learn/type/debrief-engagement-event.type';
import {
  KbCorpus,
  KbRetrievalConsumer,
} from '../../knowledge-base/enum/knowledge-base.enum';
import { KnowledgeBaseService } from '../../knowledge-base/service/knowledge-base.service';
import { LoggerService } from '../../logger/logger.service';
import { PromptSharedService } from '../../prompt/service/prompt-shared.service';
import {
  DEBRIEF_PROMPT_CODES,
  DEBRIEF_REFLECTION_CHECK_MODEL,
  DEBRIEF_REPLY_DEFAULT,
} from '../constants/debrief-release.constants';
import {
  DebriefCards,
  cardTexts,
  replyCheckFailures,
  speakerRuns,
} from '../util/debrief-cards.util';
import { DebriefAgentService } from './debrief-agent.service';
import { DebriefAiClient } from './debrief-ai.client';
import { DebriefContextRepository } from './debrief-context.repository';
import { DebriefFeedbackService } from './debrief-feedback.service';
import { DebriefRunnerService } from './debrief-runner.service';

/** The chat's assistant sender, as today's debrief chat stores it. */
const ALLY_SENDER = -1;
/** Verbatim turns sent with each reply; the debrief carries the rest. */
const HISTORY_TURNS = 10;

/** Shown in place of a reply that failed a check: honest, never the failed text. */
const CHECK_FALLBACK =
  "I'd rather not answer that the way I first wrote it. Could you ask me " +
  'about one card, or tell me more about what you meant?';

/** "If you'd like to talk to someone now:", the debrief's own distress copy. */
const SUPPORT_LEAD: Record<string, string> = {
  en: "If you'd like to talk to someone now:",
  hi: 'अगर आप अभी किसी से बात करना चाहें:',
  kn: 'ಈಗ ಯಾರಾದರೂ ಜೊತೆ ಮಾತನಾಡಲು ಇಚ್ಛಿಸಿದರೆ:',
  mr: 'आता कुणाशी बोलायचं वाटत असेल तर:',
  ta: 'இப்போது யாரிடமாவது பேச விரும்பினால்:',
};

const event = (data: Record<string, unknown>): SseMessageEvent => ({
  data: JSON.stringify(data),
});

/**
 * Ask Ally (v9 FR-43): the Debrief agent answering the learner's replies
 * under the reflective question, in the same thread today's debrief chat
 * uses, so older messages stay readable.
 *
 * Every learner message is screened first by the shared first-person risk
 * matcher; a match gets the organisation's approved crisis copy and support
 * lines instead of a model reply, and an urgent review item. The debrief's
 * Safety reader reads each message alongside the reply for distress the
 * keywords miss, and adds the support lines and the review item when it
 * finds some. A reply that fails the code checks is replaced, not shown.
 */
/**
 * The prompt's own length rule, said again after the debrief, transcript and
 * context it is followed by: from the top of a long prompt the model drifted
 * (a 190-word reply in the prod end-to-end check, 2 Nov 2026).
 */
export const REPLY_LENGTH_REMINDER =
  'Now write your reply: at most 120 words, in short paragraphs, with at most one question back.';

/** Each part of Ask Ally's extra context must arrive within this, or is left out. */
const EXTRA_CONTEXT_MS = 1200;

@Injectable()
export class DebriefReplyService {
  private readonly logger = LoggerService.getInstance(DebriefReplyService.name);

  constructor(
    @InjectRepository(ScenarioSessionChat)
    private readonly chats: Repository<ScenarioSessionChat>,
    @InjectRepository(ScenarioSessionChatMessage)
    private readonly messages: Repository<ScenarioSessionChatMessage>,
    private readonly aiChat: AiChatService,
    private readonly ai: DebriefAiClient,
    private readonly context: DebriefContextRepository,
    private readonly runner: DebriefRunnerService,
    private readonly agent: DebriefAgentService,
    private readonly feedback: DebriefFeedbackService,
    private readonly crisis: GuideCrisisService,
    private readonly prompts: PromptSharedService,
    private readonly events: EventEmitter2,
    private readonly llm: LlmProviderFactory,
    private readonly usage: LlmUsageService,
    @Optional() private readonly knowledge?: KnowledgeBaseService,
  ) {}

  async stream(
    sessionId: string,
    userId: number,
    message: string,
  ): Promise<Observable<SseMessageEvent>> {
    const run = await this.feedback.ownLiveRun(sessionId, userId);
    const tenantId = run.tenantId as string;
    const language = (run.language ?? 'en').split(/[-_]/)[0].toLowerCase();
    const chat =
      (await this.chats.findOne({
        where: { scenarioSessionId: sessionId, userId },
      })) ??
      (await this.chats.save({
        scenarioSessionId: sessionId,
        userId,
        tenantId,
      }));
    const prior = await this.messages.find({
      where: { chatId: chat.id },
      order: { createdAt: 'ASC' },
    });
    await this.messages.save({
      chatId: chat.id,
      senderId: userId,
      content: message,
      tenantId,
    });
    this.announceEngagement(prior, message, run, userId);

    // Replayed: the crisis reply, and a fast model, can emit before the
    // controller has subscribed, and nothing the learner should see is lost.
    const subject = new ReplaySubject<SseMessageEvent>();
    const finish = async (content: string) => {
      subject.next(event({ type: 'done', content, citations: [] }));
      subject.complete();
      await this.messages
        .save({ chatId: chat.id, senderId: ALLY_SENDER, content, tenantId })
        .catch((e) =>
          this.logger.error(
            `[debrief] reply not saved: ${(e as Error).message}`,
          ),
        );
    };

    if (matchFirstPersonRisk(message)) {
      // No model speaks to a learner in crisis: approved copy and lines only.
      const content = await this.supportReply(tenantId, language, true);
      void this.feedback.raiseChatDistress(run, userId, 'keyword');
      void finish(content);
      return subject.pipe(startWith(event({ type: 'start' })));
    }

    const [transcript, system, { bundle }, extra] = await Promise.all([
      this.context.transcript(sessionId),
      this.systemPrompt(),
      this.runner.resolveRelease(),
      this.extraContext(run, sessionId, userId),
    ]);
    // The release names Ask Ally's model, as it names every step's.
    const model = bundle.reply ?? DEBRIEF_REPLY_DEFAULT;
    // Read alongside the reply, never in front of it: first words stay fast.
    const distress = this.readDistress(message, language, sessionId);
    const sources = [
      ...speakerRuns(transcript),
      ...extra,
      ...cardTexts(run.cards as unknown as DebriefCards).map((c) => c.text),
    ];

    let full = '';
    this.aiChat
      .streamResponse({
        systemPrompt: [
          system,
          '',
          `SESSION LANGUAGE: ${language}`,
          'DEBRIEF:',
          JSON.stringify(run.cards),
          'TRANSCRIPT:',
          ...transcript.map((t) => `${t.role}: ${t.text}`),
          ...extra,
          '',
          REPLY_LENGTH_REMINDER,
        ].join('\n'),
        chatHistory: this.history(prior),
        userMessage: message,
        providerType: model.provider,
        // No thinking: it would spend the reply's tokens (a Gemini 2.5 reply
        // was cut mid-sentence) and delay the first words.
        llmConfig: {
          model: model.model,
          maxTokens: model.maxTokens,
          thinkingBudget: 0,
        },
        usage: {
          task: LlmTask.DEBRIEF_REPLY,
          scenarioSessionId: sessionId,
          tenantId,
          metadata: { chatId: chat.id, runId: run.id, model: model.model },
        },
      })
      .subscribe({
        next: (e) => {
          const data = JSON.parse(e.data);
          if (data.type === 'token') {
            full += data.content ?? '';
            // Both names: the web reads `text`, the phones read `content`.
            subject.next(
              event({
                type: 'token',
                content: data.content,
                text: data.content,
              }),
            );
          } else if (data.type === 'done') {
            void (async () => {
              const fails = replyCheckFailures(full, sources);
              let content = fails.length ? CHECK_FALLBACK : full;
              if (fails.length) {
                this.logger.warn(
                  `[debrief] Ask Ally reply replaced for run ${run.id}: ${fails.join(', ')}`,
                );
              }
              if (await distress) {
                void this.feedback.raiseChatDistress(
                  run,
                  userId,
                  'safety reader',
                );
                content += `\n\n${await this.supportReply(tenantId, language, false)}`;
              }
              await finish(content);
            })();
          } else if (data.type === 'error') {
            subject.next(e);
            subject.complete();
          }
        },
        error: (err) => {
          subject.next(event({ type: 'error', error: (err as Error).message }));
          subject.complete();
        },
      });
    return subject.pipe(startWith(event({ type: 'start' })));
  }

  /**
   * XP, as today's debrief chat earns it: a thread of three substantive
   * replies (DEBRIEF_THREAD), and — new with the Debrief agent — a genuine
   * answer to the reflective question (DEBRIEF_REFLECTION). Both awards are
   * idempotent per session, so repeating the event costs nothing. Never
   * throws: a reward must not break the conversation.
   */
  private announceEngagement(
    prior: ScenarioSessionChatMessage[],
    message: string,
    run: {
      tenantId?: string | null;
      scenarioSessionId: string;
      cards?: unknown;
    },
    userId: number,
  ): void {
    try {
      const params: DebriefThreadQualifiedEventParams = {
        userId,
        tenantId: run.tenantId as string,
        scenarioSessionId: run.scenarioSessionId,
      };
      const substantive =
        prior.filter(
          (m) => m.senderId === userId && isSubstantiveDebriefReply(m.content),
        ).length + (isSubstantiveDebriefReply(message) ? 1 : 0);
      if (substantive >= DEBRIEF_MIN_SUBSTANTIVE_REPLIES) {
        this.events.emit(DebriefEngagementEvent.THREAD_QUALIFIED, params);
      }
      const cards = run.cards as DebriefCards;
      const debriefTexts = cardTexts(cards).map((c) => c.text);
      if (isGenuineReflection(message, debriefTexts)) {
        // Off the reply path: the learner never waits on their XP.
        void this.onTopic(
          message,
          cards.reflective_question,
          run.scenarioSessionId,
          params.tenantId,
        ).then((yes) => {
          if (yes) {
            this.events.emit(
              DebriefEngagementEvent.REFLECTION_QUALIFIED,
              params,
            );
          }
        });
      }
    } catch (e) {
      this.logger.warn(
        `[debrief] engagement not announced: ${(e as Error).message}`,
      );
    }
  }

  /**
   * v9 FR-65's on-topic check: a model says only whether the message answers
   * the reflective question — never how well or how sincerely. Any failure
   * pays nothing; the learner can still earn it with a later answer.
   */
  private async onTopic(
    message: string,
    question: string,
    sessionId: string,
    tenantId: string,
  ): Promise<boolean> {
    try {
      const template =
        (await this.prompts.getPromptByCode(
          DEBRIEF_REFLECTION_CHECK_SYSTEM.code,
        )) ?? '';
      const system = renderPrompt(DEBRIEF_REFLECTION_CHECK_SYSTEM, template, {
        question,
      });
      const answer = await this.llm
        .getProvider(DEBRIEF_REFLECTION_CHECK_MODEL.provider)
        .getCompletion(
          [
            { role: 'system', content: system },
            { role: 'user', content: message },
          ],
          {
            model: DEBRIEF_REFLECTION_CHECK_MODEL.model,
            maxTokens: 20,
            responseFormat: 'json',
            thinkingBudget: 0,
          },
          (u) =>
            void this.usage.record({
              provider: DEBRIEF_REFLECTION_CHECK_MODEL.provider,
              model: DEBRIEF_REFLECTION_CHECK_MODEL.model,
              task: LlmTask.DEBRIEF_REFLECTION_CHECK,
              promptTokens: u.promptTokens,
              completionTokens: u.completionTokens,
              tenantId,
              scenarioSessionId: sessionId,
            }),
        );
      return JSON.parse(answer)?.on_topic === true;
    } catch {
      return false;
    }
  }

  /** The prompt the GA release pins, else the store's current, else the default file. */
  /**
   * v9 FR-43: what Ask Ally knows beyond this debrief — guidance from the
   * debrief knowledge base (as the learner's organisation may read it,
   * clinical documents only as signed off), the learner's own earlier
   * Work-on-this points, and their organisation's wording. Each part has a
   * short budget and is simply left out when it is slow or fails: the first
   * words must stay fast. The knowledge query is built from the debrief's
   * skills, never from the learner's message.
   */
  private async extraContext(
    run: { tenantId?: string | null; cards?: unknown },
    sessionId: string,
    userId: number,
  ): Promise<string[]> {
    const within = async <T>(f: () => Promise<T>, fallback: T): Promise<T> => {
      try {
        return await Promise.race([
          f(),
          new Promise<T>((r) => {
            setTimeout(() => r(fallback), EXTRA_CONTEXT_MS).unref?.();
          }),
        ]);
      } catch {
        return fallback;
      }
    };
    const tenantId = run.tenantId ?? null;
    // The knowledge base scopes by organisation id; a non-UUID tenant reads global documents.
    const kbTenantId = tenantId && isUUID(tenantId) ? tenantId : null;
    const cards = (run.cards ?? {}) as DebriefCards;
    const query = [
      ...(cards.work_on_this ?? []).map((c) => c.skill),
      ...(cards.what_worked ?? []).map((c) => c.skill),
      cards.practise_next?.skill,
    ]
      .filter((x): x is string => typeof x === 'string' && !!x.trim())
      .slice(0, 6)
      .join('; ');
    const [guidance, history, org] = await Promise.all([
      query && this.knowledge
        ? within(
            () =>
              this.knowledge!.searchForAudience(
                {
                  corpus: KbCorpus.DEBRIEF_KNOWLEDGE,
                  query,
                  limit: 3,
                  minSimilarity: 0.35,
                },
                { tenantId: kbTenantId },
                {
                  consumer: KbRetrievalConsumer.DEBRIEF,
                  sessionId,
                  userId,
                },
              ).then((r) => r.passages),
            [] as Array<{ document_title: string; text: string }>,
          )
        : Promise.resolve(
            [] as Array<{ document_title: string; text: string }>,
          ),
      within(
        () => this.context.pastWorkOnThis(userId, tenantId, sessionId, 5),
        [],
      ),
      tenantId
        ? within(() => this.context.orgWording(tenantId), null)
        : Promise.resolve(null),
    ]);
    const out: string[] = [];
    if (guidance.length) {
      out.push(
        'GUIDANCE (practice guidance your organisation uses; draw on it, never quote it as rules):',
        ...guidance.map((g) => `- ${g.document_title}: ${g.text}`),
      );
    }
    if (history.length) {
      out.push(
        "THEIR EARLIER POINTS TO WORK ON (link to these when it helps; don't list them):",
        ...history.map((h) => `- ${h.date} · ${h.skill}: ${h.point}`),
      );
    }
    if (org) {
      out.push(
        'THEIR ORGANISATION (use its wording when pointing them to their supervisor or its procedures):',
        org,
      );
    }
    return out;
  }

  private async systemPrompt(
    code: string = DEBRIEF_PROMPT_CODES.reply,
  ): Promise<string> {
    const { bundle } = await this.runner.resolveRelease();
    const pinned = (bundle.prompts as Record<string, number | undefined>)[code];
    return (
      (await this.context.promptText(code, pinned ?? null)) ??
      (await this.prompts.getPromptByCode(code)) ??
      ''
    );
  }

  /** The last few turns, as the model reads them. */
  private history(prior: ScenarioSessionChatMessage[]): LlmMessage[] {
    return prior.slice(-HISTORY_TURNS).map((m) => ({
      role: m.senderId === ALLY_SENDER ? 'assistant' : 'user',
      content: m.content,
    }));
  }

  /** True when the Safety reader finds the learner's own distress in the message. */
  private async readDistress(
    message: string,
    language: string,
    sessionId: string,
  ): Promise<boolean> {
    try {
      const res = await this.ai.step<{ learner_distress?: unknown[] }>(
        'safety-reader',
        {
          transcript: [{ turn_index: 1, role: 'counselor', text: message }],
          language,
          scenario_session_id: sessionId,
          system_prompt: await this.systemPrompt(
            DEBRIEF_PROMPT_CODES.safetyReader,
          ),
        },
      );
      return (res.learner_distress?.length ?? 0) > 0;
    } catch {
      // The keyword screen already ran; a failed read adds nothing.
      return false;
    }
  }

  /** The organisation's approved crisis or support copy, with its lines. */
  private async supportReply(
    tenantId: string,
    language: string,
    crisis: boolean,
  ): Promise<string> {
    const lines = (await this.agent.supportLines(tenantId, language))
      .map((l) => `${l.name}: ${l.phone}`)
      .join('\n');
    if (!crisis)
      return `${SUPPORT_LEAD[language] ?? SUPPORT_LEAD.en}\n${lines}`;
    const { text } = await this.crisis.responseText(tenantId, language);
    return `${text}\n\n${lines}`;
  }
}
