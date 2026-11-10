import { Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type {
  AgentRunRequest,
  CrisisCheckResponse,
  KnowledgeAnswerRequest,
  KnowledgeAudienceRequest,
} from '../../ai/dto/knowledge.dto';
import { AiService } from '../../ai/service/ai.service';
import { LoggerService } from '../../logger/logger.service';
import { NotificationErrorType } from '../../notification/type/notification.error.type';
import { PromptSharedService } from '../../prompt/service/prompt-shared.service';
import {
  WaHandledBy,
  WaTemplateKind,
  WaUnansweredReason,
} from '../../whatsapp/enum/whatsapp.enum';
import { composeReply } from '../../whatsapp/util/reply-composer';
import { ChatbotDocument } from '../entity/chatbot-document.entity';
import { ChatbotKnowledgeSource, ChatbotRuntime } from '../enum/chatbot.enum';
import {
  asksForPerson,
  handoverMessage,
  handoverOf,
} from '../handover/handover';
import { ChatbotAudienceService } from '../service/chatbot-audience.service';
import { ChatbotReplyService } from '../service/chatbot-reply.service';
import { ChatbotSettingsService } from '../service/chatbot-settings.service';
import { ConversationService } from '../service/conversation.service';
import { effectiveRuntime } from './agent-runtime';
import {
  AgentFallbackFailedError,
  AgentRuntimeRunner,
  type Answered,
  type EngineAnswer,
} from './agent-runtime-runner.service';
import type {
  AgentRunRef,
  ChatbotDecision,
  ChatTurn,
  LiveReply,
} from './chatbot-engine.types';
import { holdTextUntilCleared } from './live-reply';
import { agentAnswersInstead, isGreetingReply } from './keyword-skip';
import { buildKnowledgeRequest, NO_DOCUMENTS } from './knowledge-request';

/**
 * The ally-ai prompt codes the answering path owns.
 *
 * Derived from the file paths in ally-ai (`knowledge/whatsapp_answer` →
 * `ally_ai_knowledge_whatsapp_answer`), which is the convention its resolver uses.
 */
export const KNOWLEDGE_PROMPT_CODES = [
  'ally_ai_knowledge_whatsapp_answer',
  'ally_ai_knowledge_answer_general',
  'ally_ai_knowledge_translate_query',
  'ally_ai_knowledge_crisis_classify',
];
/** The agent's step prompt: it answers, so it takes the bot's own model like the answer prompt. */
const AGENT_SYSTEM_PROMPT_CODE = 'ally_ai_agent_system';
/**
 * The conversational agent's prompts (Agents v2). Loaded only when the agent answers, so a v1
 * request (the emergency switch off) is exactly as before.
 */
export const AGENT_PROMPT_CODES = [AGENT_SYSTEM_PROMPT_CODE];
const ANSWER_PROMPT_CODE = 'ally_ai_knowledge_whatsapp_answer';

/** Purposes with a section of their own in the Skills Store (chunk 20a-2). */
const PURPOSE_SECTIONS = new Set(['answer', 'enquiries', 'training', 'guide']);

/** The bot's purpose section, loaded only for a bot that has one. */
export function purposePromptCodes(purpose?: string | null): string[] {
  return purpose && PURPOSE_SECTIONS.has(purpose)
    ? [`ally_ai_agent_purpose_${purpose}`]
    : [];
}
/** Used by bots allowed to answer beyond their documents. */
const GENERAL_ANSWER_PROMPT_CODE = 'ally_ai_knowledge_answer_general';
/**
 * The run behind a reply, if the v2 runtime answered or was tried — kept on every outcome, a crisis
 * override included, so the reply can still be traced to its run.
 */
const runBehind = (
  answerResult: PromiseSettledResult<Answered>,
): AgentRunRef | undefined =>
  answerResult.status === 'fulfilled'
    ? answerResult.value.agent
    : answerResult.reason instanceof AgentFallbackFailedError
      ? answerResult.reason.agent
      : undefined;

/** Store version and content hash of each knowledge prompt sent to ally-ai, by code. */
type PromptsRan = {
  prompt_versions: Record<string, number | null>;
  prompt_hashes: Record<string, string>;
};

/**
 * The channel-agnostic brain of a chatbot: given one message, decide the reply.
 *
 * It never sends, stores or alerts — it returns a {@link ChatbotDecision} and the channel does
 * those things. That keeps every channel on one decision path, and lets the test console run
 * exactly what production runs without writing a row or paging anyone.
 *
 * ORDER, and why:
 *   1. keyword replies — before any model call, so a crisis reply never waits on one. A sender who
 *      is not allowed to chat still gets the safety, consent and command replies; FAQ replies are
 *      for the bot's audience only.
 *   2. access gate      — a sender not on the bot's list is refused, but the LLM crisis classifier
 *                         runs BEFORE the refusal: someone in danger is not less in danger for
 *                         being unrecognised.
 *   3. answer           — retrieval over the bot's knowledge, with its persona and model, run
 *                         concurrently with the crisis classifier, which wins over any answer.
 */
@Injectable()
export class ChatbotEngineService {
  private readonly logger = LoggerService.getInstance(
    ChatbotEngineService.name,
  );

  constructor(
    @InjectRepository(ChatbotDocument)
    private readonly documentRepository: Repository<ChatbotDocument>,
    private readonly replyService: ChatbotReplyService,
    private readonly settingsService: ChatbotSettingsService,
    private readonly audienceService: ChatbotAudienceService,
    private readonly aiService: AiService,
    private readonly promptSharedService: PromptSharedService,
    private readonly agentRuntime: AgentRuntimeRunner,
    // Optional so the engine's own specs build it without the store: then no chat is ever held.
    @Optional() private readonly conversations?: ConversationService,
  ) {}

  /**
   * Decide the reply to one message. `live` (a channel that streams) receives the run's status,
   * steps and text while it happens; the decision returned is the same either way.
   */
  async respond(turn: ChatTurn, live?: LiveReply): Promise<ChatbotDecision> {
    // ── 0. The single switch (chunk 11a) ─────────────────────────────────
    // A team member has this chat: the assistant never answers here, on any channel (they all
    // reach the engine through this method). Crisis is still checked first, and its reply always
    // goes out.
    const holder = await this.holderOf(turn);
    if (holder !== null) {
      return (
        (await this.crisisOnly(turn)) ?? {
          handledBy: WaHandledBy.HELD,
          body: '',
          held: true,
        }
      );
    }
    // "Talk to a person" (English, Hindi, Hinglish): after crisis, never instead of it.
    if (asksForPerson(turn.text)) {
      return (
        (await this.crisisOnly(turn)) ?? {
          handledBy: WaHandledBy.HANDOVER,
          body: handoverMessage(handoverOf(turn.settings), new Date()),
          handover: 'asked',
        }
      );
    }
    return this.decide(turn, live);
  }

  /** Who holds this chat: a team member's id, or null (the assistant). A lookup failure is null. */
  private async holderOf(turn: ChatTurn): Promise<number | null> {
    if (!this.conversations) return null;
    try {
      return await this.conversations.holderOf(turn.conversationId);
    } catch (error) {
      this.logger.warn(
        `Could not read who holds conversation ${turn.conversationId}; the assistant answers: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      return null;
    }
  }

  /**
   * Crisis alone (chunk 11a): the keyword templates, then the classifier. The crisis decision, or
   * null when it isn't one. Used while a person holds a chat and before a hand-over, so a crisis
   * reply never waits for anyone.
   */
  private async crisisOnly(turn: ChatTurn): Promise<ChatbotDecision | null> {
    const match = await this.replyService.match(
      turn.text,
      turn.language,
      turn.chatbot.id,
    );
    if (match && match.template.kind === WaTemplateKind.CRISIS) {
      return this.keywordCrisis(turn, match.template);
    }
    if (!turn.settings.crisisClassifierEnabled) return null;
    try {
      const { prompts, ran } = await this.loadPromptOverrides(turn);
      const crisis = await this.aiService.checkWhatsAppCrisis({
        message: turn.text,
        prompts,
      });
      return crisis?.is_crisis
        ? this.crisisDecision(turn, crisis, ran, { notOnList: false })
        : null;
    } catch (error) {
      // As in `answer()`: a classifier outage doesn't stop the message; the keyword layer ran.
      this.logger.warn(
        `Crisis classifier did not run (${turn.sender.label}): ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      return null;
    }
  }

  /** The fixed safety reply for a crisis keyword, with its Slack alert. */
  private keywordCrisis(
    turn: ChatTurn,
    template: { id: string; responseText?: string | null },
  ): ChatbotDecision {
    const { chatbot, settings, sender } = turn;
    return {
      handledBy: WaHandledBy.CRISIS,
      body: this.settingsService.renderPlaceholders(
        template.responseText || settings.crisisEscalationText,
        settings,
      ),
      templateId: template.id,
      alert: this.alert(
        200,
        'crisis',
        `A crisis keyword matched on chatbot "${chatbot.name}" (${turn.channel.type}, ` +
          `sender ${sender.label}). The fixed safety reply was sent.`,
        'Chatbot Crisis Keyword',
      ),
    };
  }

  private async decide(
    turn: ChatTurn,
    live?: LiveReply,
  ): Promise<ChatbotDecision> {
    const { chatbot, settings, sender } = turn;
    const allowed = await this.audienceService.canChat(chatbot, sender);
    // v2 (the conversational agent) unless the platform's emergency switch is off.
    const useAgent = effectiveRuntime(settings) === ChatbotRuntime.V2;

    // ── 1. Keyword replies ───────────────────────────────────────────────
    const match = await this.replyService.match(
      turn.text,
      turn.language,
      chatbot.id,
    );
    const usable =
      match &&
      match.bypassRag &&
      (allowed || match.template.kind !== WaTemplateKind.FAQ) &&
      // The agent answers greetings, help and FAQ-style messages itself.
      !(useAgent && agentAnswersInstead(match.template, turn));
    if (match && usable) {
      const isCrisis = match.template.kind === WaTemplateKind.CRISIS;
      // A bot with its own welcome message greets with THAT, not the generic shared greeting —
      // otherwise "hello" is answered with two different hellos.
      const welcome = chatbot.persona?.greeting?.trim();
      if (welcome && isGreetingReply(match.template)) {
        return {
          handledBy: WaHandledBy.TEMPLATE,
          body: welcome,
          templateId: match.template.id,
          isWelcome: true,
        };
      }
      // A crisis reply carries its Slack alert, so a human learns about it in near real time. A
      // crisis reply that only lands in a table nobody is watching is a log entry, not an
      // escalation.
      if (isCrisis) return this.keywordCrisis(turn, match.template);
      return {
        handledBy: WaHandledBy.TEMPLATE,
        body: this.settingsService.renderPlaceholders(
          match.template.responseText,
          settings,
        ),
        templateId: match.template.id,
      };
    }

    // ── 2. Access gate ───────────────────────────────────────────────────
    const needsOrganisation =
      chatbot.knowledgeSource === ChatbotKnowledgeSource.ORGANISATION &&
      !sender.tenantId;
    if (!allowed || needsOrganisation) {
      return this.refuse(turn);
    }

    // ── 3. Answer ────────────────────────────────────────────────────────
    return this.answer(turn, useAgent, live);
  }

  /**
   * Tell a sender this bot is not for them — but check for a crisis first. The keyword rules that
   * already ran are only the first layer of the safety net; skipping the classifier here would
   * remove the second for precisely the people we know least about.
   *
   * Nothing is filed as unanswered: that queue records what the KNOWLEDGE failed to cover.
   */
  private async refuse(turn: ChatTurn): Promise<ChatbotDecision> {
    const { settings, sender } = turn;
    if (settings.crisisClassifierEnabled) {
      try {
        const { prompts, ran } = await this.loadPromptOverrides(turn);
        const crisis = await this.aiService.checkWhatsAppCrisis({
          message: turn.text,
          prompts,
        });
        if (crisis?.is_crisis) {
          return this.crisisDecision(turn, crisis, ran, { notOnList: true });
        }
      } catch (error) {
        // Swallowed on purpose: the refusal still has to go out.
        this.logger.warn(
          `Crisis classifier did not run for a refused sender (${sender.label}): ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
      }
    }
    return {
      handledBy: WaHandledBy.UNIDENTIFIED,
      body: this.settingsService.renderPlaceholders(
        settings.unrecognisedNumberText,
        settings,
      ),
    };
  }

  /**
   * The request a v2 answer for this turn would send to `/agent/run`, built by the same code as
   * `answer` (the prompts, the knowledge, `buildKnowledgeRequest`, the runner's body), without
   * answering (chunk 20d-2). The owner's "How it works" asks ally-ai to build the instructions
   * from it, so nothing is copied that could drift.
   */
  async agentRequestFor(turn: ChatTurn): Promise<AgentRunRequest> {
    const { prompts } = await this.loadPromptOverrides(turn, true);
    const knowledge = await this.knowledgeFor(turn);
    const request = buildKnowledgeRequest(turn, prompts, knowledge);
    return this.agentRuntime.requestFor(turn, request, knowledge, {
      conversationId: turn.conversationId ?? 'how-it-works',
      runId: 'how-it-works',
    });
  }

  private async answer(
    turn: ChatTurn,
    useAgent: boolean,
    live?: LiveReply,
  ): Promise<ChatbotDecision> {
    const { settings } = turn;
    const { prompts, ran } = await this.loadPromptOverrides(turn, useAgent);
    const knowledge = await this.knowledgeFor(turn);
    const request = buildKnowledgeRequest(turn, prompts, knowledge);

    // Concurrent, not sequential: the classifier adds no latency this way, and `allSettled`
    // keeps a rejected classifier from taking down an answer that arrived fine. The crisis check
    // runs once and exactly as before, whichever engine answers.
    const crisisCheck = settings.crisisClassifierEnabled
      ? this.aiService.checkWhatsAppCrisis({ message: turn.text, prompts })
      : Promise.resolve(null);
    // A streamed reply's text waits for the crisis check too: none of it is shown before the
    // check clears the message, and none at all if it doesn't.
    const [answerResult, crisisResult] = await Promise.allSettled([
      useAgent
        ? this.agentRuntime.answer(
            turn,
            request,
            knowledge,
            live && holdTextUntilCleared(live, crisisCheck),
          )
        : this.answerWithV1(request),
      crisisCheck,
    ]);
    const agent = runBehind(answerResult);

    // Crisis wins over the answer, unconditionally. Not gated on confidence: the prompt tells the
    // model to choose crisis when uncertain, so re-gating here would undo that instruction.
    const crisis =
      crisisResult.status === 'fulfilled' ? crisisResult.value : null;
    if (crisis?.is_crisis) {
      return {
        ...this.crisisDecision(turn, crisis, ran, { notOnList: false }),
        ...(agent ? { agent } : {}),
      };
    }

    const degradedAlert = this.degradedAlertFor(turn, crisisResult);

    if (answerResult.status === 'rejected') {
      // A model or index outage is NOT "the knowledge does not cover this": fallback wording and an
      // ERROR-reason queue row, so a bad afternoon for ally-ai does not fill the unanswered queue
      // with questions the documents answer perfectly well.
      const failure =
        answerResult.reason instanceof AgentFallbackFailedError
          ? answerResult.reason.cause
          : answerResult.reason;
      const reason =
        failure instanceof Error ? failure.message : 'unknown error';
      this.logger.error(`Knowledge agent call failed: ${reason}`);
      return {
        handledBy: WaHandledBy.ERROR,
        body: settings.fallbackText,
        unanswered: {
          reason: WaUnansweredReason.ERROR,
          topSimilarity: null,
          hitCount: 0,
        },
        alert: degradedAlert,
        ...(agent ? { agent } : {}),
      };
    }

    const { response: answer } = answerResult.value;
    const decision = this.toDecision(turn, answer, ran, degradedAlert);
    if (agent) decision.agent = agent;
    return decision;
  }

  /**
   * The fixed safety reply for a message the crisis classifier flagged, with its Slack alert. For a
   * sender not on the bot's list (`notOnList`) the alert says so; otherwise it says the answer that
   * came back alongside was discarded.
   */
  private crisisDecision(
    turn: ChatTurn,
    crisis: CrisisCheckResponse,
    ran: PromptsRan,
    { notOnList }: { notOnList: boolean },
  ): ChatbotDecision {
    const { chatbot, settings, sender } = turn;
    const who = notOnList ? ' for a sender who is not on its list' : '';
    const outcome = notOnList
      ? 'The fixed safety reply was sent. The sender is not linked to an Ally account, so the ' +
        'sender id is the only handle to follow up through.'
      : 'The fixed safety reply was sent and the answer was discarded.';
    return {
      handledBy: WaHandledBy.CRISIS,
      body: this.settingsService.renderPlaceholders(
        settings.crisisEscalationText,
        settings,
      ),
      retrievalMeta: { ...ran },
      alert: this.alert(
        200,
        'crisis',
        `The crisis classifier fired on chatbot "${chatbot.name}"${who} (${turn.channel.type}, ` +
          `sender ${sender.label}, confidence ${crisis.confidence.toFixed(2)}, signal ` +
          `"${crisis.signal}"). ${outcome}`,
        'Chatbot Crisis Classifier',
      ),
    };
  }

  /**
   * A classifier that did not run is a degraded safety net held up by keywords alone — and
   * indistinguishable from a quiet day on every dashboard, so it is alerted, not just logged.
   */
  private degradedAlertFor(
    turn: ChatTurn,
    crisisResult: PromiseSettledResult<CrisisCheckResponse | null>,
  ): NotificationErrorType | undefined {
    const { chatbot, settings, sender } = turn;
    const crisis =
      crisisResult.status === 'fulfilled' ? crisisResult.value : null;
    const degraded =
      settings.crisisClassifierEnabled &&
      (crisisResult.status === 'rejected' || Boolean(crisis?.failed));
    if (!degraded) return undefined;
    const reason =
      crisisResult.status === 'rejected'
        ? crisisResult.reason instanceof Error
          ? crisisResult.reason.message
          : 'unknown error'
        : 'ally-ai reported failed=true on the crisis check';
    this.logger.warn(
      `Crisis classifier did not run for this message; keyword rules only (${reason})`,
    );
    return this.alert(
      500,
      'crisis-classifier-degraded',
      `The crisis classifier did not run for a message to chatbot "${chatbot.name}" ` +
        `(sender ${sender.label}). Reason: ${reason}. The keyword rules ran and are holding ` +
        `the safety net alone — check ally-ai's crisis-check route and its model provider key. ` +
        `Expect NO crisis alerts while this persists.`,
      'Chatbot Crisis Classifier Degraded',
    );
  }

  /** The v1 engine: ally-ai's `/knowledge-agent/answer`, with its own retry budget. */
  private async answerWithV1(
    request: KnowledgeAnswerRequest,
  ): Promise<Answered> {
    const startedAt = Date.now();
    const response = await this.aiService.answerKnowledgeQuestion(request);
    return { response, latencyMs: Date.now() - startedAt };
  }

  /** An answer from either engine, as one reply. */
  private toDecision(
    turn: ChatTurn,
    answer: EngineAnswer,
    ran: PromptsRan,
    degradedAlert: NotificationErrorType | undefined,
  ): ChatbotDecision {
    const { chatbot, settings } = turn;
    const maxReplyChars = Math.min(
      settings.maxReplyChars,
      turn.channel.capabilities?.maxReplyChars ?? settings.maxReplyChars,
    );
    const turnType = answer.turn_type;
    const body = composeReply({
      intent: answer.intent,
      answer: answer.answer,
      declineText: settings.declineText,
      // A channel that lists sources itself gets the answer without the text footer; the
      // decision still carries every citation.
      citations: turn.channel.capabilities?.showsSources
        ? []
        : answer.citations,
      maxAnswerChars: settings.maxAnswerChars,
      maxReplyChars,
      maxCitations: settings.maxCitations,
    });

    return {
      handledBy:
        answer.intent === 'answer'
          ? WaHandledBy.RAG
          : answer.intent === 'clarify'
            ? WaHandledBy.CLARIFIED
            : WaHandledBy.DECLINED,
      body,
      citations: answer.citations as unknown as Record<string, any>[],
      retrievalMeta: {
        ...answer.retrieval,
        // What ACTUALLY ran, which is not necessarily what was chosen: dispatch falls back when a
        // key is missing or a provider fails.
        provider: answer.provider,
        model: answer.model,
        prompt_version: answer.prompt_version,
        chatbot_id: chatbot.id,
        ...(turnType ? { turn_type: turnType } : {}),
        ...ran,
      },
      language: answer.language,
      ...(turnType ? { turnType } : {}),
      // The agent's hello or "who I am": on a first message, the notice follows it, as it follows
      // the welcome message.
      ...(turnType === 'smalltalk' || turnType === 'about_bot'
        ? { isWelcome: true }
        : {}),
      // A CLARIFY is not filed: too vague to retrieve against is not evidence of a gap.
      unanswered:
        answer.intent === 'decline'
          ? {
              reason: this.mapDeclineReason(answer.decline_reason),
              topSimilarity: answer.retrieval?.top_similarity ?? null,
              hitCount: answer.retrieval?.hit_count ?? 0,
            }
          : undefined,
      alert: degradedAlert,
    };
  }

  /**
   * Which documents the answer may come from.
   *
   * `selected` sends the bot's documents as a PRE-filter — always an array, never omitted, because
   * ally-ai reads an omitted list as "search everything". An empty selection therefore declines
   * every question, which is the honest behaviour for a bot with no knowledge yet. `organisation`
   * is the original per-asker targeting, used by the platform number.
   */
  private async knowledgeFor(
    turn: ChatTurn,
  ): Promise<Pick<KnowledgeAnswerRequest, 'audience' | 'document_ids'>> {
    if (turn.chatbot.knowledgeSource === ChatbotKnowledgeSource.ORGANISATION) {
      const audience: KnowledgeAudienceRequest = {
        tenant_id: turn.sender.tenantId ?? null,
        include_global: true,
      };
      return { audience };
    }
    const documentIds =
      turn.documentIds ??
      (
        await this.documentRepository.find({
          where: { chatbotId: turn.chatbot.id },
          select: ['documentId'],
        })
      ).map((row) => row.documentId);
    return {
      audience: { unrestricted: true },
      // An empty list is sent as an id that matches nothing. ally-ai builds before chatbots read
      // `[]` as "no filter" — search everything — which would answer a bot with no documents from
      // the whole library. The placeholder means "nothing" to every version.
      document_ids: documentIds.length ? documentIds : [NO_DOCUMENTS],
    };
  }

  /**
   * Prompt overrides for the knowledge prompts, carrying the selected model.
   *
   * The Skills Store is the source of truth for the text and the platform's model choice. A bot
   * with its own model replaces the provider/model on the ANSWER prompt only, for this request
   * only — translation and the crisis classifier keep the platform's choice, so a bot's model can
   * never weaken the safety check.
   *
   * The agent's prompt is loaded (and takes the bot's model) only when the agent answers.
   *
   * Also returns which store version of each prompt was sent, recorded on the reply.
   */
  private async loadPromptOverrides(
    turn: ChatTurn,
    useAgent = false,
  ): Promise<{
    prompts: Record<string, unknown>;
    ran: PromptsRan;
  }> {
    const ran: PromptsRan = { prompt_versions: {}, prompt_hashes: {} };
    let prompts: Record<string, unknown> = {};
    try {
      const rows = await this.promptSharedService.getPromptsByOptions({
        promptCode: [
          ...(useAgent
            ? [...KNOWLEDGE_PROMPT_CODES, ...AGENT_PROMPT_CODES]
            : KNOWLEDGE_PROMPT_CODES),
          ...purposePromptCodes(turn.chatbot.purpose),
        ],
      });
      prompts = (rows ?? []).reduce<Record<string, unknown>>((acc, row) => {
        const entry: Record<string, unknown> = {};
        const content = row.prompt?.trim();
        if (content) {
          entry.prompt = content;
          ran.prompt_versions[row.promptCode] = row.version ?? null;
          if (row.contentHash)
            ran.prompt_hashes[row.promptCode] = row.contentHash;
        }
        if (row.provider) entry.provider = row.provider;
        if (row.model) entry.model = row.model;
        if (typeof row.temperature === 'number')
          entry.temperature = row.temperature;
        if (row.availableVariables) {
          entry.availableVariables = row.availableVariables;
        }
        // An entry with nothing in it would override nothing but still ship a key; skip it.
        if (Object.keys(entry).length) acc[row.promptCode] = entry;
        return acc;
      }, {});
    } catch (error) {
      // ally-ai's own file defaults are sane; not worth failing a question over.
      this.logger.warn(
        `Could not load prompt overrides; ally-ai defaults will be used: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }

    const model = turn.chatbot.model;
    if (model?.provider && model?.model) {
      const answering = [ANSWER_PROMPT_CODE, GENERAL_ANSWER_PROMPT_CODE];
      if (useAgent) answering.push(AGENT_SYSTEM_PROMPT_CODE);
      for (const code of answering) {
        const current = (prompts[code] ?? {}) as Record<string, unknown>;
        const next: Record<string, unknown> = {
          ...current,
          provider: model.provider,
          model: model.model,
        };
        if (typeof model.temperature === 'number')
          next.temperature = model.temperature;
        else delete next.temperature;
        prompts = { ...prompts, [code]: next };
      }
    }
    return { prompts, ran };
  }

  private mapDeclineReason(reason: string): WaUnansweredReason {
    switch (reason) {
      case 'no_hits':
        return WaUnansweredReason.NO_HITS;
      case 'below_threshold':
        return WaUnansweredReason.BELOW_THRESHOLD;
      case 'model_declined':
        return WaUnansweredReason.MODEL_DECLINED;
      default:
        return WaUnansweredReason.ERROR;
    }
  }

  private alert(
    statusCode: number,
    path: string,
    message: string,
    type: string,
  ): NotificationErrorType {
    return {
      statusCode,
      timestamp: new Date().toISOString(),
      path: `chatbot/${path}`,
      message,
      type,
    } as NotificationErrorType;
  }
}
