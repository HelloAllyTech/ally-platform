import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Observable, ReplaySubject, startWith } from 'rxjs';
import { Repository } from 'typeorm';
import {
  AiChatService,
  SseMessageEvent,
} from '../../ai-chat/service/ai-chat.service';
import { LlmMessage } from '../../ai-chat/interface/llm-provider.interface';
import { matchFirstPersonRisk } from '../../common/safety/first-person-risk.matcher';
import { GuideCrisisService } from '../../guide/safety/guide-crisis.service';
import { ScenarioSessionChat } from '../../learn/entity/scenario-session-chat.entity';
import { ScenarioSessionChatMessage } from '../../learn/entity/scenario-session-chat-message.entity';
import { LlmTask } from '../../learn/enum/llm-task.enum';
import { LoggerService } from '../../logger/logger.service';
import { PromptSharedService } from '../../prompt/service/prompt-shared.service';
import {
  DEBRIEF_PROMPT_CODES,
  DEBRIEF_REPLY_MODEL,
} from '../constants/debrief-release.constants';
import {
  DebriefCards,
  cardTexts,
  replyCheckFailures,
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

    const [transcript, system] = await Promise.all([
      this.context.transcript(sessionId),
      this.systemPrompt(),
    ]);
    // Read alongside the reply, never in front of it: first words stay fast.
    const distress = this.readDistress(message, language, sessionId);
    const sources = [
      ...transcript.map((t) => t.text),
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
        ].join('\n'),
        chatHistory: this.history(prior),
        userMessage: message,
        providerType: DEBRIEF_REPLY_MODEL.providerType,
        llmConfig: {
          model: DEBRIEF_REPLY_MODEL.model,
          maxTokens: DEBRIEF_REPLY_MODEL.maxTokens,
        },
        usage: {
          task: LlmTask.DEBRIEF_REPLY,
          scenarioSessionId: sessionId,
          tenantId,
          metadata: { chatId: chat.id, runId: run.id },
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

  /** The prompt the GA release pins, else the store's current, else the default file. */
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
