import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  KnowledgeAnswerRequest,
  KnowledgeAnswerResponse,
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
import {
  ChatbotAnswerMode,
  ChatbotKnowledgeSource,
} from '../enum/chatbot.enum';
import { ChatbotAudienceService } from '../service/chatbot-audience.service';
import { ChatbotReplyService } from '../service/chatbot-reply.service';
import { ChatbotSettingsService } from '../service/chatbot-settings.service';
import type { ChatbotDecision, ChatTurn } from './chatbot-engine.types';

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
const ANSWER_PROMPT_CODE = 'ally_ai_knowledge_whatsapp_answer';
/** Used by bots allowed to answer beyond their documents. */
const GENERAL_ANSWER_PROMPT_CODE = 'ally_ai_knowledge_answer_general';
/** A document id no document has: the "search nothing" filter. */
const NO_DOCUMENTS = '00000000-0000-0000-0000-000000000000';

/** Words that make a command reply the "say hello" reply (the shared Greeting). */
const GREETING_WORDS = new Set([
  'hi',
  'hello',
  'hey',
  'hii',
  'namaste',
  'hola',
  'good morning',
]);

/** The shared reply to a bare hello: a command reply triggered by greeting words. */
export const isGreetingReply = (template: {
  kind: WaTemplateKind;
  patterns: string[];
}): boolean =>
  template.kind === WaTemplateKind.COMMAND &&
  (template.patterns ?? []).some((p) =>
    GREETING_WORDS.has(ChatbotReplyService.normalise(p)),
  );

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
  ) {}

  async respond(turn: ChatTurn): Promise<ChatbotDecision> {
    const { chatbot, settings, sender } = turn;
    const allowed = await this.audienceService.canChat(chatbot, sender);

    // ── 1. Keyword replies ───────────────────────────────────────────────
    const match = await this.replyService.match(
      turn.text,
      turn.language,
      chatbot.id,
    );
    const usable =
      match &&
      match.bypassRag &&
      (allowed || match.template.kind !== WaTemplateKind.FAQ);
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
      return {
        handledBy: isCrisis ? WaHandledBy.CRISIS : WaHandledBy.TEMPLATE,
        body: this.settingsService.renderPlaceholders(
          isCrisis
            ? match.template.responseText || settings.crisisEscalationText
            : match.template.responseText,
          settings,
        ),
        templateId: match.template.id,
        // Routed to the existing Slack exception path so a human learns about it in near real
        // time. A crisis reply that only lands in a table nobody is watching is a log entry, not an
        // escalation.
        alert: isCrisis
          ? this.alert(
              200,
              'crisis',
              `A crisis keyword matched on chatbot "${chatbot.name}" (${turn.channel.type}, ` +
                `sender ${sender.label}). The fixed safety reply was sent.`,
              'Chatbot Crisis Keyword',
            )
          : undefined,
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
    return this.answer(turn);
  }

  /**
   * Tell a sender this bot is not for them — but check for a crisis first. The keyword rules that
   * already ran are only the first layer of the safety net; skipping the classifier here would
   * remove the second for precisely the people we know least about.
   *
   * Nothing is filed as unanswered: that queue records what the KNOWLEDGE failed to cover.
   */
  private async refuse(turn: ChatTurn): Promise<ChatbotDecision> {
    const { chatbot, settings, sender } = turn;
    if (settings.crisisClassifierEnabled) {
      try {
        const { prompts, ran } = await this.loadPromptOverrides(turn);
        const crisis = await this.aiService.checkWhatsAppCrisis({
          message: turn.text,
          prompts,
        });
        if (crisis?.is_crisis) {
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
              `The crisis classifier fired on chatbot "${chatbot.name}" for a sender who is not ` +
                `on its list (${turn.channel.type}, sender ${sender.label}, confidence ` +
                `${crisis.confidence.toFixed(2)}, signal "${crisis.signal}"). The fixed safety ` +
                `reply was sent. The sender is not linked to an Ally account, so the sender id is ` +
                `the only handle to follow up through.`,
              'Chatbot Crisis Classifier',
            ),
          };
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

  private async answer(turn: ChatTurn): Promise<ChatbotDecision> {
    const { chatbot, settings, sender } = turn;
    const { prompts, ran } = await this.loadPromptOverrides(turn);
    const knowledge = await this.knowledgeFor(turn);

    // Concurrent, not sequential: the classifier adds no latency this way, and `allSettled`
    // keeps a rejected classifier from taking down an answer that arrived fine.
    const [answerResult, crisisResult] = await Promise.allSettled([
      this.aiService.answerKnowledgeQuestion({
        question: turn.text,
        history: turn.history,
        prompts,
        ...knowledge,
        persona: this.personaRequest(turn),
        answer_mode: chatbot.answerMode ?? ChatbotAnswerMode.DOCUMENTS_ONLY,
        channel: turn.channel.type,
        top_k: settings.retrieval.topK,
        min_similarity: settings.retrieval.minSimilarity,
        decline_similarity: settings.retrieval.declineSimilarity,
        max_passages: settings.retrieval.maxPassages,
        max_context_tokens: settings.retrieval.maxContextTokens,
        similarity_band: settings.retrieval.similarityBand,
        max_answer_chars: settings.maxAnswerChars,
        translate_query: settings.retrieval.translateQuery,
      }),
      settings.crisisClassifierEnabled
        ? this.aiService.checkWhatsAppCrisis({ message: turn.text, prompts })
        : Promise.resolve(null),
    ]);

    // Crisis wins over the answer, unconditionally. Not gated on confidence: the prompt tells the
    // model to choose crisis when uncertain, so re-gating here would undo that instruction.
    const crisis =
      crisisResult.status === 'fulfilled' ? crisisResult.value : null;
    if (crisis?.is_crisis) {
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
          `The crisis classifier fired on chatbot "${chatbot.name}" (${turn.channel.type}, ` +
            `sender ${sender.label}, confidence ${crisis.confidence.toFixed(2)}, signal ` +
            `"${crisis.signal}"). The fixed safety reply was sent and the answer was discarded.`,
          'Chatbot Crisis Classifier',
        ),
      };
    }

    // A classifier that did not run is a degraded safety net held up by keywords alone — and
    // indistinguishable from a quiet day on every dashboard, so it is alerted, not just logged.
    const degraded =
      settings.crisisClassifierEnabled &&
      (crisisResult.status === 'rejected' || Boolean(crisis?.failed));
    let degradedAlert: NotificationErrorType | undefined;
    if (degraded) {
      const reason =
        crisisResult.status === 'rejected'
          ? crisisResult.reason instanceof Error
            ? crisisResult.reason.message
            : 'unknown error'
          : 'ally-ai reported failed=true on the crisis check';
      this.logger.warn(
        `Crisis classifier did not run for this message; keyword rules only (${reason})`,
      );
      degradedAlert = this.alert(
        500,
        'crisis-classifier-degraded',
        `The crisis classifier did not run for a message to chatbot "${chatbot.name}" ` +
          `(sender ${sender.label}). Reason: ${reason}. The keyword rules ran and are holding ` +
          `the safety net alone — check ally-ai's crisis-check route and its model provider key. ` +
          `Expect NO crisis alerts while this persists.`,
        'Chatbot Crisis Classifier Degraded',
      );
    }

    if (answerResult.status === 'rejected') {
      // A model or index outage is NOT "the knowledge does not cover this": fallback wording and an
      // ERROR-reason queue row, so a bad afternoon for ally-ai does not fill the unanswered queue
      // with questions the documents answer perfectly well.
      const reason =
        answerResult.reason instanceof Error
          ? answerResult.reason.message
          : 'unknown error';
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
      };
    }

    const answer: KnowledgeAnswerResponse = answerResult.value;
    const maxReplyChars = Math.min(
      settings.maxReplyChars,
      turn.channel.capabilities?.maxReplyChars ?? settings.maxReplyChars,
    );
    const body = composeReply({
      intent: answer.intent,
      answer: answer.answer,
      declineText: settings.declineText,
      citations: answer.citations,
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
        ...ran,
      },
      language: answer.language,
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

  private personaRequest(turn: ChatTurn): KnowledgeAnswerRequest['persona'] {
    const persona = turn.chatbot.persona ?? {};
    const out = {
      display_name: persona.displayName?.trim() || undefined,
      system_prompt: persona.systemPrompt?.trim() || undefined,
      tone: persona.tone?.trim() || undefined,
    };
    return Object.values(out).some(Boolean) ? out : undefined;
  }

  /**
   * Prompt overrides for the knowledge prompts, carrying the selected model.
   *
   * The Skills Store is the source of truth for the text and the platform's model choice. A bot
   * with its own model replaces the provider/model on the ANSWER prompt only, for this request
   * only — translation and the crisis classifier keep the platform's choice, so a bot's model can
   * never weaken the safety check.
   *
   * Also returns which store version of each prompt was sent, recorded on the reply.
   */
  private async loadPromptOverrides(turn: ChatTurn): Promise<{
    prompts: Record<string, unknown>;
    ran: PromptsRan;
  }> {
    const ran: PromptsRan = { prompt_versions: {}, prompt_hashes: {} };
    let prompts: Record<string, unknown> = {};
    try {
      const rows = await this.promptSharedService.getPromptsByOptions({
        promptCode: KNOWLEDGE_PROMPT_CODES,
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
      for (const code of [ANSWER_PROMPT_CODE, GENERAL_ANSWER_PROMPT_CODE]) {
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
