import { DEFAULT_WHATSAPP_SETTINGS } from '../../whatsapp/type/whatsapp-settings.type';
import { LimitReason, TurnBlockReason, limitReply } from './limit-reply';
import {
  BlockedState,
  FIND_A_HELPLINE_URL,
  blockedNotice,
  fixedCrisisInformation,
  newHelplines,
  ownerCreditsText,
} from './blocked-notice';
import { BlockedCrisisService } from 'src/billing/service/blocked-crisis.service';
import { LimitsService } from 'src/billing/service/limits.service';
import { usageContextFor } from './engine-usage';
import { offMessage, offReasonOf } from '../safety/off-message';
import { isIndiaAssistant } from '../agent-tools/list-tools';
import { usageContext } from 'src/billing/context/usage-context';
import { Injectable, Optional } from '@nestjs/common';
import {
  crisisReply,
  emergencyKindOf,
  emergencyReply,
} from '../../bot-draft/safety-pack/safety-packs';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type {
  AgentRunRequest,
  CrisisCheckResponse,
  KnowledgeAnswerRequest,
  KnowledgeAudienceRequest,
} from '../../ai/dto/knowledge.dto';
import { crisisLevelOf } from '../../ai/dto/knowledge.dto';
import { AiService } from '../../ai/service/ai.service';
import { LoggerService } from '../../logger/logger.service';
import { NotificationErrorType } from '../../notification/type/notification.error.type';
import { LateCrisisService } from '../safety/late-crisis.service';
import { INVITE_ONLY } from '../../whatsapp/wa-a-copy';
import { PromptSharedService } from '../../prompt/service/prompt-shared.service';
import {
  WaHandledBy,
  WaTemplateKind,
  WaUnansweredReason,
} from '../../whatsapp/enum/whatsapp.enum';
import { composeReply } from '../../whatsapp/util/reply-composer';
import { ChatbotDocument } from '../entity/chatbot-document.entity';
import { ChatbotKnowledgeSource } from '../enum/chatbot.enum';
import {
  asksForPerson,
  handoverMessage,
  handoverOf,
} from '../handover/handover';
import { ChatbotAudienceService } from '../service/chatbot-audience.service';
import { ChatbotReplyService } from '../service/chatbot-reply.service';
import {
  ChatbotSettingsService,
  DEFAULT_HELPLINE_PLACEHOLDER,
} from '../service/chatbot-settings.service';
import { ConversationService } from '../service/conversation.service';
import {
  AgentActedError,
  AgentRunFailedError,
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
import { crisisRequest } from './crisis-history';
import { FINAL_ONLY_PACKS, holdTextUntilCleared } from './live-reply';
import { isEverydayIdiom } from './everyday-idiom';
import { looksEmotional } from './looks-emotional';
import { ActionsService } from '../actions/actions.service';
import { businessFacts } from './business-facts';
import { agentAnswersInstead, isGreetingReply } from './keyword-skip';
import { buildKnowledgeRequest, NO_DOCUMENTS } from './knowledge-request';
import { stageLine, stageRunIdFor } from './agent-stage-log';
import { voiceText } from '../voice/voice-text';
import { asksToOverride, overrideDecline } from './visitor-override';
import {
  atRiskByKeywords,
  crisisByKeywords,
  selfHarmByKeywords,
  upsetByKeywords,
  emergencyByKeywords,
  lifeThreatening,
  moreSevere,
} from './emergency-keywords';
import {
  asksForDiagnosis,
  caringDecline,
  DIAGNOSIS_PACKS,
  diagnosisDecline,
} from './caring-decline';
import { crisisHelplines } from './crisis-helplines';
import { replyLanguageOf } from './reply-language';
import {
  isChildSafeguarding,
  selfHarmHere,
  withSafeguardingLine,
} from './safeguarding';
import { helplineNumbersWithExtras } from '../quick-replies/quick-reply-copy.service';
import {
  curatedLanguageOf,
  SafetyTranslationsService,
} from '../languages/safety-translations.service';
import { replyLanguageFor } from '../languages/reply-language-for';
import {
  AnswerConflictService,
  type ConflictPassage,
} from '../knowledge/answer-conflict.service';
import { noAnswerReply } from '../knowledge/no-answer-reply';
import { safetySettingsOf } from '../safety/safety-settings';
import { CONFLICT_NOT_SURE_COPY } from './conflict-reply';
import {
  aboutAnAnimal,
  type ContactSource,
  contactFromSources,
  emailIn,
  emergencyNumberFrom,
  phoneIn,
  runFailedReply,
} from './run-failed-reply';

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
/** The conversational agent's prompts (Agents v2), loaded for every answer. */
export const AGENT_PROMPT_CODES = [
  AGENT_SYSTEM_PROMPT_CODE,
  // What it knows about the person (chunk 8a); used only when the bot's memory is on.
  'ally_ai_agent_memory',
  // How it uses the business's lists (chunk 6). Missing until 6b, so a run always used the
  // default text in ally-ai's code, never the Skills Store's live version.
  'ally_ai_agent_lists',
  // When the crisis check finds the person upset, not at risk (Q3-fast Part 1).
  'ally_ai_agent_upset',
  'ally_ai_agent_upset_support',
  // The numbers it may give an upset person, on every pack (Q4 G7).
  'ally_ai_agent_upset_numbers',
  // What each kind of list tool adds, whatever the purpose (Q3-fast Part 2b).
  'ally_ai_agent_playbook_booking',
  'ally_ai_agent_playbook_details',
  'ally_ai_agent_playbook_orders',
  'ally_ai_agent_playbook_reference',
];
const ANSWER_PROMPT_CODE = 'ally_ai_knowledge_whatsapp_answer';

/**
 * The crisis reply (chunk 6b, item 25): `crisisReply`, which always carries a phone number. The
 * bot's own wording is its crisis text, or its own crisis keyword template on the keyword path; the
 * platform's text and templates are never sent. The same on the keyword and the classifier paths.
 */
export function crisisTextFor(
  turn: Pick<ChatTurn, 'chatbot' | 'settings'> &
    Partial<Pick<ChatTurn, 'text' | 'language'>>,
  template?: {
    chatbotId?: string | null;
    responseText?: string | null;
    /** Stage 5: regional numbers a builder added to its locked crisis reply. */
    extraNumbers?: string[] | null;
    /** False: the copy's wording is still the global's (`TemplateMatch.ownWording`). */
    ownWording?: boolean;
  } | null,
): string {
  const own_ = Boolean(
    template?.chatbotId &&
    template.chatbotId === turn.chatbot.id &&
    // TF1 round 2: a copy still worded as the platform's global is not the builder's wording.
    template.ownWording !== false,
  );
  // Stage 5 (D6): the chatbot's own numbers, then its copy's regional ones. Q4 G7: only numbers
  // the owner confirmed in Safety.
  const numbers = helplineNumbersWithExtras(
    crisisHelplines(turn.settings),
    own_ ? template?.extraNumbers : null,
  );
  const fill = (text: string) =>
    text.replace(
      /\{helpline_numbers\}/g,
      numbers || DEFAULT_HELPLINE_PLACEHOLDER,
    );
  const ownTemplate = own_ ? template?.responseText?.trim() : '';
  const ownText = turn.chatbot.settings?.crisisEscalationText?.trim();
  const own = ownTemplate || ownText;
  const reply = crisisReply({
    pack: turn.chatbot.safetyPack,
    helplineNumbers: numbers,
    own: own ? fill(own) : null,
    // In the person's language (Q3-fast Part 1, B3): fixed English, Hindi or Hinglish text.
    language: replyLanguageOf(turn.text ?? '', turn.language),
    // 112 and Tele-MANAS 14416 for an assistant in India (by its time zone).
    india: isIndiaAssistant(turn.chatbot.settings),
  });
  // TF1 round 2 (Saathi B-13): the voice's one warm sentence before the fixed core, in the same
  // message (none without a template voice).
  const lead = voiceText(
    turn.chatbot.settings,
    'crisis_lead',
    replyLanguageOf(turn.text ?? '', turn.language),
  );
  const withLead = lead ? `${lead} ${reply}` : reply;
  // Q4 G7: the owner's one approved practical-help line, after the fixed reply.
  const practical = turn.settings.crisisPracticalLine?.trim();
  return practical ? `${withLead}\n\n${practical}` : withLead;
}

/** TF1 round 2 (Saathi B-13): an emergency reply's own lead from the voice ("Please stay safe."). */
function withEmergencyLead(
  turn: Pick<ChatTurn, 'chatbot'> &
    Partial<Pick<ChatTurn, 'text' | 'language'>>,
  reply: string,
): string {
  const lead = voiceText(
    turn.chatbot.settings,
    'crisis_lead_emergency',
    replyLanguageOf(turn.text ?? '', turn.language),
  );
  return lead ? `${lead} ${reply}` : reply;
}

/**
 * A reply to a message the crisis check couldn't judge (it timed out or failed) that may be at
 * risk: the reply, then the fixed crisis information, unless it already carries it (112 and 14416
 * in India, the link elsewhere). Never on a crisis reply, which has its own.
 */
export function withUnsureCrisisInformation(
  turn: Pick<ChatTurn, 'chatbot'> &
    Partial<Pick<ChatTurn, 'text' | 'language'>>,
  decision: ChatbotDecision,
): ChatbotDecision {
  const body = decision.body ?? '';
  if (decision.handledBy === WaHandledBy.CRISIS || !body.trim())
    return decision;
  const india = isIndiaAssistant(turn.chatbot.settings);
  const carried = india
    ? /\b112\b/.test(body) && body.includes('14416')
    : body.includes(FIND_A_HELPLINE_URL);
  if (carried) return decision;
  const numbers = newHelplines(
    crisisHelplines(turn.chatbot.settings as never) || '',
    body,
  );
  const help = fixedCrisisInformation(
    numbers || null,
    replyLanguageOf(turn.text ?? '', turn.language),
    india,
  );
  return { ...decision, body: `${body.trim()}\n\n${help}` };
}

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
    : answerResult.reason instanceof AgentRunFailedError ||
        answerResult.reason instanceof AgentActedError
      ? answerResult.reason.agent
      : undefined;

/**
 * How long a message waits for the crisis check's level before the run starts (Q3-fast Part 1):
 * long enough for the classifier's p90 (about 2.5 s on the local stack), so an upset person's
 * reply opens warmly and an at-risk one gets the fixed reply with no run at all. A slower check
 * still runs beside the run and wins over it.
 */
export const LEVEL_WAIT_MS = 2_500;

/** A promise's outcome, never rejecting. */
const settle = <T>(promise: Promise<T>): Promise<PromiseSettledResult<T>> =>
  promise.then(
    (value) => ({ status: 'fulfilled', value }) as const,
    (reason) => ({ status: 'rejected', reason }) as const,
  );

/** Null after `ms`, without keeping the process alive. */
const after = (ms: number): Promise<null> =>
  new Promise((resolve) => setTimeout(() => resolve(null), ms).unref?.());

/** The check said at risk or an emergency: the fixed reply, now. */
const isUrgent = (
  verdict: PromiseSettledResult<CrisisCheckResponse | null>,
): verdict is PromiseFulfilledResult<CrisisCheckResponse> =>
  verdict.status === 'fulfilled' && Boolean(verdict.value?.is_crisis);

/** A decision reached with no model call: a keyword or template reply, or a refusal. */
const modelFree = (decision: ChatbotDecision): boolean =>
  decision.handledBy === WaHandledBy.TEMPLATE ||
  decision.handledBy === WaHandledBy.UNIDENTIFIED ||
  (decision.handledBy === WaHandledBy.CRISIS && Boolean(decision.templateId));

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
 *   3. answer           — the agent's run (one path for every channel, Q3-fast: no v1), run
 *                         concurrently with the crisis classifier, which wins over any answer.
 *                         A run that fails gets the fixed run-failed reply.
 */
@Injectable()
export class ChatbotEngineService {
  private readonly logger = LoggerService.getInstance(
    ChatbotEngineService.name,
  );
  /** `LEVEL_WAIT_MS`; specs set 0 to start the run at once and race the check against it. */
  levelWaitMs = LEVEL_WAIT_MS;

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
    // CR1: plans, seats and tokens. Optional so the engine's own specs build it without them.
    @Optional() private readonly limits?: LimitsService,
    // Stage 6 (R1): records a keyword crisis on a blocked turn. Optional for the engine's specs.
    @Optional() private readonly blockedCrisis?: BlockedCrisisService,
    // Stage 5: reviewed crisis translations and conflict handling. Optional for the engine's specs.
    @Optional() private readonly safetyTranslations?: SafetyTranslationsService,
    @Optional() private readonly answerConflict?: AnswerConflictService,
    // BT1: a Confirm or Keep it tap is answered in code. Optional for the engine's specs.
    @Optional() private readonly actions?: ActionsService,
    // WA-A §0a: flags a chat when the crisis verdict comes after the reply. Optional for the specs.
    @Optional() private readonly lateCrisis?: LateCrisisService,
  ) {}

  /**
   * Decide the reply to one message. `live` (a channel that streams) receives the run's status,
   * steps and text while it happens; the decision returned is the same either way.
   */
  async respond(turn: ChatTurn, live?: LiveReply): Promise<ChatbotDecision> {
    // CR1: every model call this message causes (crisis check, the run, memory, summary) is
    // attributed to this assistant, conversation and run. Recording happens elsewhere, after.
    return usageContext.run(usageContextFor(turn), async () => {
      const decision = await this.withTranslatedCrisisHelp(
        turn,
        await this.respondInContext(turn, live),
      );
      // BT1: a crisis between taps wins. The write a card was waiting on is dropped, so no button
      // shown before the crisis can still write.
      if (decision.handledBy === WaHandledBy.CRISIS && turn.conversationId) {
        await this.actions?.forgetOffer(turn.chatbot.id, turn.conversationId);
      }
      // Stage 6: the payer stamped on this run when it started, for the channel's background
      // work after the reply (memory, summary), which runs outside this context.
      const context = usageContext.current();
      return context?.payerAccountId
        ? {
            ...decision,
            payer: {
              accountId: context.payerAccountId,
              endPersonId: context.endPersonId ?? null,
            },
          }
        : decision;
    });
  }

  /**
   * The free crisis keyword check alone (no model), as the engine reads it: a crisis template
   * that is not inside an everyday idiom. A channel runs it before the stage 5 privacy steps, so
   * a crisis message is never read as an erase request or a consent answer. A lookup failure
   * counts as a crisis (the privacy steps are skipped and the engine decides).
   */
  async isCrisisKeyword(
    text: string,
    language: string | null | undefined,
    chatbotId: string,
  ): Promise<boolean> {
    try {
      const match = await this.replyService.match(text, language, chatbotId);
      return (
        match?.template.kind === WaTemplateKind.CRISIS && !isEverydayIdiom(text)
      );
    } catch {
      return true;
    }
  }

  /**
   * Stage 5 (D5): a crisis reply to a person writing in an enabled language with no curated text
   * (anything but English and Hindi) also carries the reviewed translation of the help line, when
   * one is stored. The curated reply is never replaced, and an unreviewed text is never used.
   */
  private async withTranslatedCrisisHelp(
    turn: ChatTurn,
    decision: ChatbotDecision,
  ): Promise<ChatbotDecision> {
    if (decision.handledBy !== WaHandledBy.CRISIS || !this.safetyTranslations)
      return decision;
    const language = replyLanguageFor(turn.chatbot, turn.language);
    if (!turn.language || curatedLanguageOf(language)) return decision;
    try {
      const help = await this.safetyTranslations.crisisHelpFor(
        turn.chatbot.id,
        language,
        // The builder's own numbers only (R6), as on the fixed notifications; Q4 G7: confirmed ones.
        crisisHelplines(turn.chatbot.settings) || null,
      );
      if (curatedLanguageOf(help.language) || !help.reviewed) return decision;
      return { ...decision, body: `${decision.body}\n\n${help.text}` };
    } catch {
      return decision;
    }
  }

  private async respondInContext(
    turn: ChatTurn,
    live?: LiveReply,
  ): Promise<ChatbotDecision> {
    // Stage 4: an archived or paused chatbot (by its team or by the go-live gate, D10) answers
    // with its off message and the crisis information, never silence and never a model call. The
    // free keyword crisis check still runs first (R1). The test pane is the team's, so it answers.
    const off =
      turn.channel?.type === 'test' ? null : offReasonOf(turn.chatbot);
    if (off) {
      const crisis = await this.keywordCrisisOnly(
        turn,
        `OFF_${off.toUpperCase()}`,
      );
      if (crisis) return { ...crisis, off };
      return {
        handledBy: WaHandledBy.RATE_LIMITED,
        body: offMessage(
          turn.chatbot as never,
          replyLanguageOf(turn.text, turn.language),
        ),
        off,
      };
    }
    // At any limit no run starts and NO model is called (stage 6, D3 as amended by R1): the free
    // keyword crisis check runs first and its reply always goes out (the channel flags it);
    // otherwise the person gets the fixed notification. Stage 6 also reserves the turn's money
    // here, from the chatbot's budget or (testing) the builder's free balance.
    const limited = await this.limits?.checkTurn({
      chatbotId: turn.chatbot.id,
      creatorUserId: turn.chatbot.createdBy,
      conversationKey: turn.conversationId ?? turn.sender?.externalId,
      context: usageContext.current(),
      sender: {
        phone: turn.sender?.phone ?? null,
        email: turn.sender?.email ?? null,
        label: turn.sender?.label ?? null,
      },
      userLimits: turn.chatbot.settings?.userLimits ?? null,
      timeZone: turn.chatbot.settings?.timeZone ?? null,
    });
    if (limited) return this.blockedDecision(turn, limited);
    const decision = await this.respondUnlimited(turn, live);
    // A reply that needed no model (a keyword reply, a refusal) gives its reservation back now
    // rather than holding the budget until the reservation expires.
    if (!decision.agent && modelFree(decision)) {
      void this.limits
        ?.releaseTurn(usageContext.current())
        .catch(() => undefined);
    }
    return decision;
  }

  /**
   * A blocked turn (R1): the free keyword crisis match, then the fixed notification. Never a model
   * call: neither the agent nor the crisis classifier runs.
   */
  private async blockedDecision(
    turn: ChatTurn,
    limited: TurnBlockReason,
  ): Promise<ChatbotDecision> {
    const state: BlockedState | undefined =
      limited === 'out_of_credits' ? 'OUT_OF_CREDITS' : undefined;
    const crisis = await this.keywordCrisisOnly(turn, state ?? 'LIMITED');
    if (crisis) return { ...crisis, ...(state ? { blocked: state } : {}) };
    if (limited === 'out_of_credits') {
      return {
        handledBy: WaHandledBy.RATE_LIMITED,
        body: this.blockedText(turn, 'OUT_OF_CREDITS'),
        limited,
        blocked: 'OUT_OF_CREDITS',
      };
    }
    if (limited === 'owner_credits') {
      return {
        handledBy: WaHandledBy.RATE_LIMITED,
        body: ownerCreditsText(usageContext.current()?.creditBlockReason),
        limited,
      };
    }
    return {
      handledBy: WaHandledBy.RATE_LIMITED,
      body: await this.limitText(turn, limited),
      limited,
    };
  }

  /** The fixed notification for a blocked state, in the person's language. */
  private blockedText(turn: ChatTurn, state: BlockedState): string {
    return blockedNotice(state, {
      // The builder's own numbers only (R6): never the platform's defaults. Q4 G7: confirmed ones.
      ownNumbers: crisisHelplines(turn.chatbot.settings) || null,
      language: replyLanguageOf(turn.text, turn.language),
      india: isIndiaAssistant(turn.chatbot.settings),
    });
  }

  /**
   * The keyword layer's crisis reply alone (R1), or null: no model. A match on a blocked turn is
   * recorded through `markBlockedCrisis`; the channel flags the conversation from the decision.
   */
  private async keywordCrisisOnly(
    turn: ChatTurn,
    state: string,
  ): Promise<ChatbotDecision | null> {
    const match = await this.replyService.match(
      turn.text,
      turn.language,
      turn.chatbot.id,
    );
    const template =
      match &&
      match.template.kind === WaTemplateKind.CRISIS &&
      !isEverydayIdiom(turn.text)
        ? match
        : null;
    // TF1 round 2 (approved 25 Nov): the free keyword rules still run here, with no model call. A
    // message they mark at risk or an emergency flags the chat and alerts the team, as it would
    // with credits.
    const byRules = template
      ? null
      : crisisByKeywords(turn.text, turn.chatbot.safetyPack);
    if (!template && !byRules) return null;
    await this.blockedCrisis
      ?.markBlockedCrisis(
        turn.chatbot.id,
        turn.conversationId ?? turn.sender?.externalId,
        state,
      )
      .catch(() => undefined);
    if (byRules) {
      return this.crisisDecision(turn, byRules, {} as PromptsRan, {
        notOnList: false,
        path: 'keyword',
      });
    }
    return this.keywordCrisis(turn, {
      ...template!.template,
      ownWording: template!.ownWording,
    });
  }

  /** The fixed reply at a limit, in the person's language, naming the business or its owner. */
  private async limitText(
    turn: ChatTurn,
    reason: LimitReason,
  ): Promise<string> {
    const language = replyLanguageOf(turn.text, turn.language);
    if (reason === 'customers') {
      return limitReply(reason, language, {
        business: turn.chatbot.name,
        contact: contactFromSources(
          await this.businessFacts(turn),
          crisisHelplines(turn.settings),
        ),
      });
    }
    let owner: string | null = null;
    if (reason === 'no_seat' || reason === 'seat_messages') {
      const [row] = await this.documentRepository.manager
        .query(
          `SELECT u.name FROM chatbot_members m JOIN users u ON u.id = m.user_id
            WHERE m.chatbot_id = $1 AND 'owner' = ANY(m.roles) ORDER BY m."createdAt" LIMIT 1`,
          [turn.chatbot.id],
        )
        .catch(() => []);
      owner = row?.name ?? null;
    }
    return limitReply(reason, language, { owner });
  }

  private async respondUnlimited(
    turn: ChatTurn,
    live?: LiveReply,
  ): Promise<ChatbotDecision> {
    // ── 0. The single switch (chunk 11a) ─────────────────────────────────
    // A team member has this chat: the assistant never answers here, on any channel (they all
    // reach the engine through this method). Crisis is still checked first, and its reply always
    // goes out.
    const holder = await this.holderOf(turn);
    if (holder !== null) {
      return (
        (await this.crisisOnly(turn, { held: true })) ?? {
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
          body: handoverMessage(
            handoverOf(turn.settings),
            new Date(),
            replyLanguageOf(turn.text ?? '', turn.language),
          ),
          handover: 'asked',
        }
      );
    }
    return this.decide(turn, live);
  }

  /**
   * The crisis classifier's verdict alone, asked exactly as `answer` asks it: no keyword rules and
   * no reply. The crisis eval's fast mode (chunk 15a); a channel never calls this.
   */
  async classifyCrisis(turn: ChatTurn): Promise<CrisisCheckResponse | null> {
    const { prompts } = await this.loadPromptOverrides(turn);
    return this.aiService.checkWhatsAppCrisis(crisisRequest(turn, prompts));
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
   *
   * While a person holds the chat (`held`) the classifier judges the latest message alone (chunk
   * 15a): it can't see the team member's messages, so "yes" to "are you safe right now?" would read
   * as confirming an earlier disclosure, and the fixed reply would land on top of their conversation.
   * The team sees every held message anyway.
   */
  private async crisisOnly(
    turn: ChatTurn,
    { held = false }: { held?: boolean } = {},
  ): Promise<ChatbotDecision | null> {
    const match = await this.replyService.match(
      turn.text,
      turn.language,
      turn.chatbot.id,
    );
    if (
      match &&
      match.template.kind === WaTemplateKind.CRISIS &&
      !isEverydayIdiom(turn.text)
    ) {
      return this.keywordCrisis(turn, {
        ...match.template,
        ownWording: match.ownWording,
      });
    }
    if (!turn.settings.crisisClassifierEnabled) return null;
    try {
      const { prompts, ran } = await this.loadPromptOverrides(turn);
      const crisis = await this.aiService.checkWhatsAppCrisis(
        crisisRequest(held ? { ...turn, history: [] } : turn, prompts),
      );
      return crisis?.is_crisis
        ? await this.crisisDecision(turn, crisis, ran, { notOnList: false })
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
    template: {
      id: string;
      responseText?: string | null;
      chatbotId?: string | null;
      extraNumbers?: string[] | null;
      ownWording?: boolean;
    },
  ): ChatbotDecision {
    const { chatbot, sender } = turn;
    return {
      handledBy: WaHandledBy.CRISIS,
      body: crisisTextFor(turn, template),
      templateId: template.id,
      // Stage 4: the flag service reads the level and path from here, never infers them.
      crisis: { level: 1, path: 'keyword' },
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

    // ── 1. Keyword replies ───────────────────────────────────────────────
    const match = await this.replyService.match(
      turn.text,
      turn.language,
      chatbot.id,
    );
    // "I want to die of boredom" (stop 1): a crisis keyword inside an everyday idiom is left to
    // the classifier, which runs beside the answer.
    const idiom =
      match?.template.kind === WaTemplateKind.CRISIS &&
      isEverydayIdiom(turn.text);
    const usable =
      match &&
      !idiom &&
      match.bypassRag &&
      (allowed || match.template.kind !== WaTemplateKind.FAQ) &&
      // The agent answers greetings, help and FAQ-style messages itself.
      !agentAnswersInstead(match.template, turn);
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
      if (isCrisis)
        return this.keywordCrisis(turn, {
          ...match.template,
          ownWording: match.ownWording,
        });
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
      return this.refuse(turn, { organisationOnly: needsOrganisation });
    }

    // ── 3. A tap (BT1) ───────────────────────────────────────────────────
    // After every gate a typed message passes: a Confirm writes with no model call; any other tap
    // is answered like the words it stands for.
    if (turn.tap) {
      const tapped = await this.actions?.perform(turn);
      if (tapped) return tapped;
    } else {
      // TF1 F2: a typed yes to the card just shown confirms that card, as its tap would.
      const typed = await this.actions?.typedYes?.(turn);
      if (typed) return typed;
    }

    // ── 4. Answer ────────────────────────────────────────────────────────
    return this.answerLogged(turn, live);
  }

  /** `answer`, with its start and end as stage lines (chunk H1 Part A). Changes nothing. */
  private async answerLogged(
    turn: ChatTurn,
    live?: LiveReply,
  ): Promise<ChatbotDecision> {
    const runKey = stageRunIdFor(turn.providerMessageId);
    const startedAt = Date.now();
    this.logger.info(
      stageLine(runKey, startedAt, 'engine_answer_start', {
        channel: turn.channel?.type,
      }),
    );
    // WA-A §0a: a crisis verdict that answers after its wait still counts. When the reply already
    // sent was not the crisis reply, an at-risk late verdict flags the chat and alerts the team.
    let lateVerdict: (verdict: CrisisCheckResponse) => void = () => undefined;
    const late = new Promise<CrisisCheckResponse>((resolve) => {
      lateVerdict = resolve;
    });
    try {
      const decision = await this.answer(turn, live, lateVerdict);
      this.logger.info(
        stageLine(runKey, startedAt, 'engine_answer_end', {
          handled_by: decision.handledBy,
        }),
      );
      if (decision.handledBy !== WaHandledBy.CRISIS && this.lateCrisis) {
        void late.then((verdict) => {
          if (!verdict?.is_crisis) return;
          this.logger.info(
            stageLine(runKey, startedAt, 'crisis_late_verdict', {
              level: crisisLevelOf(verdict) ?? 'none',
            }),
          );
          return this.lateCrisis?.flag(turn, verdict);
        });
      }
      return decision;
    } catch (error) {
      this.logger.info(
        stageLine(runKey, startedAt, 'engine_answer_end', {
          handled_by: 'threw',
          error: error instanceof Error ? error.name : 'unknown',
        }),
      );
      throw error;
    }
  }

  /**
   * Tell a sender this bot is not for them (REMOVED_FROM_LIST), with no model call (R1): the free
   * keyword crisis check runs (a match gets the crisis reply, and the channel flags it); the model
   * classifier does not. An assistant's refusal is the fixed notification (the crisis information
   * and that access is by invitation, D4); the platform number, which scopes its answers by
   * organisation, keeps its own unrecognised-number text.
   *
   * Nothing is filed as unanswered: that queue records what the KNOWLEDGE failed to cover.
   */
  private async refuse(
    turn: ChatTurn,
    { organisationOnly = false }: { organisationOnly?: boolean } = {},
  ): Promise<ChatbotDecision> {
    const { settings } = turn;
    const crisis = await this.keywordCrisisOnly(turn, 'REMOVED_FROM_LIST');
    if (crisis) return { ...crisis, blocked: 'REMOVED_FROM_LIST' };
    if (organisationOnly) {
      return {
        handledBy: WaHandledBy.UNIDENTIFIED,
        body: this.settingsService.renderPlaceholders(
          settings.unrecognisedNumberText,
          settings,
        ),
      };
    }
    return {
      handledBy: WaHandledBy.UNIDENTIFIED,
      body: await this.inviteOnlyText(turn),
      blocked: 'REMOVED_FROM_LIST',
    };
  }

  /**
   * WA-A §4 (RC1 §4): an assistant that is by invitation says who to ask: "This assistant is by
   * invitation. Please contact <organisation> at <contact>." (the phone or email in its own
   * sources), then the crisis information, as always (D4). No list is revealed.
   */
  private async inviteOnlyText(turn: ChatTurn): Promise<string> {
    const language = replyLanguageOf(turn.text, turn.language);
    // The organisation's own phone or email from its sources only: never a helpline (the merged
    // settings can hold the platform's default numbers), which is not who grants access.
    const contact = contactFromSources(await this.businessFacts(turn));
    const copy = INVITE_ONLY[language] ?? INVITE_ONLY.en;
    const lead = (contact ? copy.withContact : copy.withoutContact)
      .replace('{organisation}', turn.chatbot.name)
      .replace('{contact}', contact ?? '');
    return `${lead} ${fixedCrisisInformation(
      crisisHelplines(turn.chatbot.settings) || null,
      language,
      isIndiaAssistant(turn.chatbot.settings),
    )}`;
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
    // Never a gateway: "How it works" builds instructions, it doesn't run tools.
    return this.agentRuntime.requestFor(turn, request, knowledge, {
      conversationId: turn.conversationId ?? 'how-it-works',
      runId: 'how-it-works',
      withGateway: false,
    });
  }

  private async answer(
    turn: ChatTurn,
    live?: LiveReply,
    onLate?: (verdict: CrisisCheckResponse) => void,
  ): Promise<ChatbotDecision> {
    const { settings } = turn;
    const runKey = stageRunIdFor(turn.providerMessageId);
    const startedAt = Date.now();
    const { prompts, ran } = await this.loadPromptOverrides(turn, true);
    const knowledge = await this.knowledgeFor(turn);
    const request = buildKnowledgeRequest(turn, prompts, knowledge);
    this.logger.info(
      stageLine(runKey, startedAt, 'context_loaded', {
        documents: knowledge.document_ids?.length ?? 0,
      }),
    );

    // Something on screen at once (chunk H1 Part C): the run, and for an emotional message the
    // crisis level, can take seconds to send their own first status.
    if (live && turn.channel.capabilities?.streaming) {
      live.onEvent({
        event: 'status',
        data: { code: 'thinking', label: 'Reading the question' },
      });
    }

    // One fast check beside the run (Q3-fast Part 1). It never depends on the run: a failed run
    // still gets its verdict, and a rejected check never takes down an answer.
    // Q4 H1: with history, the latest message is also judged on its own, in parallel, and the more
    // severe verdict wins, so a message at risk on its own is never cleared by its context (8
    // booking turns before "some days I feel there's no point to anything").
    const crisisAsk = crisisRequest(turn, prompts);
    const classifier = settings.crisisClassifierEnabled
      ? crisisAsk.history?.length
        ? Promise.allSettled([
            this.aiService.checkWhatsAppCrisis(crisisAsk, { onLate }),
            this.aiService.checkWhatsAppCrisis(
              { message: turn.text, prompts },
              { onLate },
            ),
          ]).then(([withHistory, alone]) => {
            const value = (
              r: PromiseSettledResult<CrisisCheckResponse | null>,
            ) => (r.status === 'fulfilled' ? r.value : null);
            if (
              withHistory.status === 'rejected' &&
              alone.status === 'rejected'
            ) {
              throw withHistory.reason;
            }
            return moreSevere(value(withHistory), value(alone));
          })
        : this.aiService.checkWhatsAppCrisis(crisisAsk, { onLate })
      : Promise.resolve(null);
    const classified = settle(classifier);
    // When the classifier fails (chunk H1): the emergency keyword rules decide. A match is an
    // emergency verdict like the classifier's, so it takes the same fast path.
    const byKeywords = (): CrisisCheckResponse | null => {
      const verdict = emergencyByKeywords(turn.text, turn.chatbot.safetyPack);
      if (verdict) {
        this.logger.warn(
          `Crisis classifier failed for chatbot ${turn.chatbot.id}; an emergency keyword rule ` +
            `matched, so the emergency reply goes out`,
        );
      }
      return verdict;
    };
    // Q4: a life-threatening emergency by the keyword rules decides at once, on any assistant,
    // whatever the classifier says (it missed "someone collapsed in the hub and isn't breathing").
    const urgent =
      lifeThreatening(turn.text) ??
      // TF1 round 2: self-harm said in the first person, on every assistant.
      selfHarmByKeywords(turn.text) ??
      // Q4 H1: indirect hopelessness on a mental-health assistant.
      atRiskByKeywords(turn.text, turn.chatbot.safetyPack);
    if (urgent) {
      this.logger.warn(
        `Life-threatening emergency rule matched for chatbot ${turn.chatbot.id}; the emergency reply goes out`,
      );
    }
    // TF1 round 2, S-3: distress on a mental-health assistant is at least upset, never decided by
    // the keywords alone: the classifier's verdict still counts, and the more severe one wins.
    const distress = urgent
      ? null
      : upsetByKeywords(turn.text, turn.chatbot.safetyPack);
    const crisisCheck: Promise<CrisisCheckResponse | null> = urgent
      ? Promise.resolve(urgent)
      : classifier.then(
          (verdict) => {
            const judged = verdict?.failed
              ? (byKeywords() ?? verdict)
              : verdict;
            return distress ? moreSevere(judged, distress) : judged;
          },
          (error: unknown) => {
            const verdict = byKeywords() ?? distress;
            if (verdict) return verdict;
            throw error;
          },
        );
    if (settings.crisisClassifierEnabled) {
      this.logger.info(stageLine(runKey, startedAt, 'crisis_check_start'));
      crisisCheck.then(
        (verdict) =>
          this.logger.info(
            stageLine(runKey, startedAt, 'crisis_check_end', {
              level: crisisLevelOf(verdict) ?? 'none',
              urgent: isUrgent({ status: 'fulfilled', value: verdict }),
            }),
          ),
        (error) =>
          this.logger.info(
            stageLine(runKey, startedAt, 'crisis_check_end', {
              level: 'failed',
              error: error instanceof Error ? error.name : 'unknown',
            }),
          ),
      );
    }
    const checked = settle(crisisCheck);
    // TF1 S7: a worry about a child's safety is answered from the organisation's own procedure,
    // with the fixed child-protection line, not the self-harm reply. Still the fixed reply when the
    // person is at risk themselves, or for a medical emergency.
    const safeguarding = isChildSafeguarding(turn.text);
    const fixedReply = (
      verdict: PromiseSettledResult<CrisisCheckResponse | null>,
    ): verdict is PromiseFulfilledResult<CrisisCheckResponse> =>
      isUrgent(verdict) &&
      !(
        safeguarding &&
        !selfHarmHere(turn.text) &&
        crisisLevelOf(verdict.value) !== 'emergency'
      );

    // 1. Only for a message that looks emotional (stop 1, option c): the level, if it comes within
    //    LEVEL_WAIT_MS (the classifier's p90 is about 2.5 s). At risk or an emergency: the fixed
    //    reply goes out now, with no run at all. Upset: the run is told, so its reply opens warmly.
    //    Every other message starts its run at once; the check still races it below.
    const waitMs = looksEmotional(turn.text) ? this.levelWaitMs : 0;
    this.logger.info(
      stageLine(runKey, startedAt, 'crisis_wait_before_run', {
        wait_ms: waitMs,
      }),
    );
    const early = await Promise.race([checked, after(waitMs)]);
    if (early && fixedReply(early)) {
      return this.crisisDecision(turn, early.value!, ran, { notOnList: false });
    }
    // TF1 round 2 (Saathi B-5): on a mental-health assistant, a request to be diagnosed gets the
    // fixed reply (only a doctor or mental health professional can; Tele-MANAS 14416), the same
    // every time and with no run. The crisis verdict comes first and wins ("I think I have
    // depression and I don't want to live").
    if (
      DIAGNOSIS_PACKS.has(String(turn.chatbot.safetyPack ?? '')) &&
      asksForDiagnosis(turn.text)
    ) {
      const verdict = early ?? (await checked);
      if (fixedReply(verdict)) {
        return this.crisisDecision(turn, verdict.value!, ran, {
          notOnList: false,
        });
      }
      return {
        handledBy: WaHandledBy.TEMPLATE,
        body: diagnosisDecline({
          question: turn.text ?? '',
          language: replyLanguageOf(turn.text, turn.language),
          organisation: turn.chatbot.name,
          contact: contactFromSources(
            await this.businessFacts(turn),
            crisisHelplines(turn.settings),
          ),
          pack: turn.chatbot.safetyPack,
        }),
      };
    }
    // TF1 round 2, S-4: "ignore your instructions…" gets one fixed line and no run. The crisis
    // verdict is awaited first and wins ("ignore all the rules, I just want to die").
    if (asksToOverride(turn.text)) {
      const verdict = early ?? (await checked);
      if (fixedReply(verdict)) {
        return this.crisisDecision(turn, verdict.value!, ran, {
          notOnList: false,
        });
      }
      this.logger.info(
        `Chatbot ${turn.chatbot.id}: a request to drop its rules got the fixed decline`,
      );
      return {
        handledBy: WaHandledBy.TEMPLATE,
        body: overrideDecline(
          replyLanguageOf(turn.text, turn.language),
          turn.chatbot.name,
          turn.chatbot.settings,
        ),
      };
    }
    const mood =
      (early?.status === 'fulfilled' &&
        crisisLevelOf(early.value) === 'upset') ||
      distress
        ? 'upset'
        : undefined;

    // 2. The run. A streamed reply's text waits for the check: none of it is shown before the
    //    check clears the message, and none at all if it doesn't. A verdict that comes in during
    //    the run and says at risk or an emergency cancels the run and is sent at once.
    const stop = new AbortController();
    const running = settle(
      this.agentRuntime.answer(
        turn,
        request,
        knowledge,
        live &&
          holdTextUntilCleared(live, crisisCheck, {
            finalOnly:
              FINAL_ONLY_PACKS.has(String(turn.chatbot.safetyPack ?? '')) ||
              mood === 'upset',
          }),
        { mood, signal: stop.signal },
      ),
    );
    if (!early) {
      const first = await Promise.race([
        running.then(() => null),
        checked.then((verdict) => (fixedReply(verdict) ? verdict : null)),
      ]);
      if (first) {
        stop.abort();
        return this.crisisDecision(turn, first.value!, ran, {
          notOnList: false,
        });
      }
    }
    const [answerResult, crisisResult] = await Promise.all([running, checked]);
    // The check timed out or failed and no keyword rule decided (b3-r01, b4-r01, b2-r02 on
    // 24 Nov): the message is "unsure", as in Q4 H1. A reply to one that could be at risk then
    // always carries the crisis information (112 and Tele-MANAS 14416 in India), never only a
    // contact line.
    const unsure =
      settings.crisisClassifierEnabled &&
      looksEmotional(turn.text ?? '') &&
      (crisisResult.status === 'rejected' ||
        Boolean(crisisResult.value?.failed && !crisisResult.value.is_crisis));
    // Upset, not at risk (Q4 H1): the reply stays warm and its own, but always carries the crisis
    // information too, even a decline (o5-r03: "Raat ke 2 baje hain, ro raha hoon" got only an
    // email address, as ally-ai's reply check leaves declines alone).
    const upset =
      mood === 'upset' ||
      (crisisResult.status === 'fulfilled' &&
        crisisLevelOf(crisisResult.value) === 'upset');
    const decided = await (async (): Promise<ChatbotDecision> => {
      const agent = runBehind(answerResult);

      // Crisis wins over the answer, unconditionally. Not gated on confidence: the prompt tells the
      // model to choose crisis when uncertain, so re-gating here would undo that instruction.
      const crisis =
        crisisResult.status === 'fulfilled' ? crisisResult.value : null;
      if (crisis?.is_crisis && fixedReply(crisisResult)) {
        return {
          ...(await this.crisisDecision(turn, crisis, ran, {
            notOnList: false,
          })),
          ...(agent ? { agent } : {}),
        };
      }

      // Alerted on the classifier's own result, so a keyword fallback still raises it.
      const degradedAlert = this.degradedAlertFor(turn, await classified);

      // The agent passed the chat to a person (chunk 3b): its `hand_over` tool already marked the
      // chat, and the visitor gets 11a's hand-over message, as when they ask for a person. The same
      // when the run failed after `hand_over` acted; after a list write, what it did; after anything
      // else, the run-failed reply.
      const acted =
        answerResult.status === 'rejected' &&
        answerResult.reason instanceof AgentActedError
          ? answerResult.reason.tool
          : null;
      if (
        acted === 'hand_over' ||
        (answerResult.status === 'fulfilled' &&
          answerResult.value.response.handover)
      ) {
        // Q4 G1 (Round 7 R1): the hand-over never replaces an answer. The run goes on after
        // `hand_over`, so what the assistant could answer comes first, then the hand-over line, in
        // the person's language.
        const line = handoverMessage(
          handoverOf(settings),
          new Date(),
          replyLanguageOf(turn.text ?? '', turn.language),
        );
        const response =
          answerResult.status === 'fulfilled'
            ? answerResult.value.response
            : null;
        if (response?.answer?.trim()) {
          const answered = this.toDecision(turn, response, ran, degradedAlert);
          return {
            ...answered,
            handledBy: WaHandledBy.HANDOVER,
            body: `${answered.body.trim()}\n\n${line}`,
            handover: 'assistant',
            unanswered: undefined,
            ...(agent ? { agent } : {}),
          };
        }
        return {
          handledBy: WaHandledBy.HANDOVER,
          body: line,
          handover: 'assistant',
          alert: degradedAlert,
          ...(agent ? { agent } : {}),
        };
      }
      if (acted === 'confirm') {
        // The run got as far as asking for a yes (chunk H1): the question is the reply.
        const question =
          answerResult.status === 'rejected' &&
          answerResult.reason instanceof AgentActedError
            ? answerResult.reason.done
            : undefined;
        if (question) {
          return {
            handledBy: WaHandledBy.CLARIFIED,
            body: question,
            alert: degradedAlert,
            ...(agent ? { agent } : {}),
          };
        }
      }
      if (acted) {
        // A list write that was done (chunk 6) says so; anything else gets the run-failed reply.
        const done =
          answerResult.status === 'rejected' &&
          answerResult.reason instanceof AgentActedError
            ? answerResult.reason.done
            : undefined;
        return {
          handledBy: WaHandledBy.ERROR,
          body: done ?? (await this.runFailedText(turn)),
          alert: degradedAlert,
          ...(agent ? { agent } : {}),
        };
      }

      if (answerResult.status === 'rejected') {
        // A failed run is NOT "the knowledge does not cover this": the fixed run-failed reply
        // (Q3-fast Part 0, never v1) and an ERROR-reason queue row, so a bad afternoon for ally-ai
        // does not fill the unanswered queue with questions the documents answer perfectly well.
        const failure =
          answerResult.reason instanceof AgentRunFailedError
            ? answerResult.reason.cause
            : answerResult.reason;
        const reason =
          failure instanceof Error ? failure.message : 'unknown error';
        this.logger.error(`Agent run failed: ${reason}`);
        return {
          handledBy: WaHandledBy.ERROR,
          body: await this.runFailedText(turn),
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
      const decision = this.toDecision(
        this.withNoAnswerReply(
          await this.withDeclineContact(
            turn,
            answer,
            crisisLevelOf(crisis) === 'upset' || mood === 'upset',
          ),
          answer,
        ),
        answer,
        ran,
        degradedAlert,
      );
      if (agent) decision.agent = agent;
      return this.withConflictCheck(turn, answer, decision);
    })();
    if (safeguarding) {
      const flagged =
        crisisResult.status === 'fulfilled' &&
        Boolean(crisisResult.value?.is_crisis);
      if (flagged) {
        this.logger.warn(
          `Child-safeguarding message on chatbot ${turn.chatbot.id}: answered from its own information with the child-protection line`,
        );
      }
      return {
        ...decided,
        body: withSafeguardingLine(
          decided.body ?? '',
          replyLanguageOf(turn.text ?? '', turn.language),
          isIndiaAssistant(turn.chatbot.settings),
        ),
        ...(flagged && !decided.alert
          ? {
              alert: this.alert(
                200,
                'crisis',
                `A child-safeguarding message on chatbot "${turn.chatbot.name}" (${turn.channel.type}, ` +
                  `sender ${turn.sender.label}). It was answered from the assistant's own information, ` +
                  `with the child-protection numbers.`,
                'Chatbot Crisis Classifier',
              ),
            }
          : {}),
      };
    }
    const sent =
      unsure || upset ? withUnsureCrisisInformation(turn, decided) : decided;
    // TF1 round 2 (Sahyog N-6): the channel adds no memory notice or name notice to it.
    return upset ? { ...sent, upset: true } : sent;
  }

  /**
   * Stage 5, the no-answer setting: when nothing was found (no passages, or none close enough)
   * and the owner chose how to answer that (`settings.noAnswerMode`), the fixed reply for that
   * choice, ending with the crisis information. Without a stored choice the owner's decline
   * wording stays, as before.
   */
  private withNoAnswerReply(turn: ChatTurn, answer: EngineAnswer): ChatTurn {
    const stored = (turn.chatbot.settings as Record<string, unknown> | null)
      ?.noAnswerMode;
    if (
      !stored ||
      answer.intent !== 'decline' ||
      answer.answer?.trim() ||
      (answer.decline_reason !== 'no_hits' &&
        answer.decline_reason !== 'below_threshold')
    ) {
      return turn;
    }
    const mode = safetySettingsOf(turn.chatbot.settings as never).noAnswerMode;
    return {
      ...turn,
      settings: {
        ...turn.settings,
        declineText: noAnswerReply(
          mode,
          replyLanguageOf(turn.text, turn.language),
          { helplineNumbers: crisisHelplines(turn.chatbot.settings) || null },
        ),
      },
    };
  }

  /**
   * Stage 5, conflict handling at answer time: an answer grounded in passages from two documents
   * that give different phone numbers, emails or amounts is replaced by the fixed "not sure"
   * reply, and the owner is asked to fix the sources (the channel records `conflict`). The free
   * heuristic only: no model call. A lookup failure leaves the answer as it was.
   */
  private async withConflictCheck(
    turn: ChatTurn,
    answer: EngineAnswer,
    decision: ChatbotDecision,
  ): Promise<ChatbotDecision> {
    if (!this.answerConflict || answer.intent !== 'answer') return decision;
    const cited = (answer.citations ?? []).filter(
      (c) => c.chunk_id && c.document_id && !c.record_id,
    );
    if (new Set(cited.map((c) => c.document_id)).size < 2) return decision;
    try {
      const rows = (await this.documentRepository.manager.query(
        `SELECT id::text AS id, document_id::text AS document_id, text FROM kb_document_chunks WHERE id::text = ANY($1::text[])`,
        [cited.map((c) => c.chunk_id)],
      )) as { id: string; document_id: string; text: string }[];
      const byId = new Map(rows.map((r) => [r.id, r]));
      const passages: ConflictPassage[] = cited.flatMap((c) => {
        const row = byId.get(c.chunk_id);
        return row
          ? [
              {
                documentId: row.document_id,
                text: row.text,
                title: c.document_title,
              },
            ]
          : [];
      });
      const result = await this.answerConflict.detect(turn.text, passages);
      if (!result.conflict) return decision;
      return {
        ...decision,
        handledBy: WaHandledBy.DECLINED,
        body: CONFLICT_NOT_SURE_COPY[replyLanguageOf(turn.text, turn.language)],
        conflict: result,
        unanswered: {
          reason: WaUnansweredReason.CONFLICT,
          topSimilarity: answer.retrieval?.top_similarity ?? null,
          hitCount: answer.retrieval?.hit_count ?? 0,
        },
      };
    } catch (error) {
      this.logger.warn(
        `Conflict check skipped: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return decision;
    }
  }

  /**
   * A decline with no words of its own goes out in the owner's decline wording. When that wording
   * has no phone or email ("please ask our front desk"), the business's contact from its sources
   * follows it (Q3-fast Part 2, 17 Nov S10/S11): one honest line, then how to reach them.
   */
  private async withDeclineContact(
    turn: ChatTurn,
    answer: EngineAnswer,
    upset = false,
  ): Promise<ChatTurn> {
    if (answer.intent !== 'decline' || answer.answer?.trim()) return turn;
    const language = replyLanguageOf(turn.text, turn.language);
    // TF1 round 2 (Saathi B-1): the owner's own wording as they wrote it; otherwise the voice's,
    // in the person's language.
    const effective = (turn.settings.declineText ?? '').trim();
    const fromVoice =
      !effective ||
      effective === voiceText(turn.chatbot.settings, 'decline', 'en') ||
      effective === DEFAULT_WHATSAPP_SETTINGS.declineText.trim();
    const wording = fromVoice
      ? voiceText(turn.chatbot.settings, 'decline', language)
      : effective;
    const contact = contactFromSources(
      await this.businessFacts(turn),
      crisisHelplines(turn.settings),
    );
    // Upset, or a question about medicines (chunk H1 Part D): the approved warm line or polite
    // decline, never the generic "I don't know that".
    const caring = caringDecline({
      upset,
      question: turn.text ?? '',
      language: replyLanguageOf(turn.text, turn.language),
      organisation: turn.chatbot.name,
      contact,
      pack: turn.chatbot.safetyPack,
    });
    if (caring) {
      return { ...turn, settings: { ...turn.settings, declineText: caring } };
    }
    if (phoneIn(wording) || emailIn(wording) || !contact) {
      return { ...turn, settings: { ...turn.settings, declineText: wording } };
    }
    return {
      ...turn,
      settings: {
        ...turn.settings,
        declineText: `${wording} ${voiceText(turn.chatbot.settings, 'contact_line', language, { contact })}`,
      },
    };
  }

  /**
   * The fixed safety reply for a message the crisis classifier flagged, with its Slack alert. For a
   * sender not on the bot's list (`notOnList`) the alert says so; otherwise it says the answer that
   * came back alongside was discarded.
   */
  private async crisisDecision(
    turn: ChatTurn,
    crisis: CrisisCheckResponse,
    ran: PromptsRan,
    {
      notOnList,
      path = 'classifier',
    }: { notOnList: boolean; path?: 'classifier' | 'keyword' },
  ): Promise<ChatbotDecision> {
    const { chatbot, sender } = turn;
    const who = notOnList ? ' for a sender who is not on its list' : '';
    const outcome = notOnList
      ? 'The fixed safety reply was sent. The sender is not linked to an Ally account, so the ' +
        'sender id is the only handle to follow up through.'
      : 'The fixed safety reply was sent and the answer was discarded.';
    // A medical emergency (Q3-fast Part 1, C9) gets "go to the nearest emergency department now,
    // call 112 / 108", the business's own emergency number from its sources, and the at-risk line
    // only when self-harm is also present. Everything else the classifier flags is at risk.
    const emergency = crisisLevelOf(crisis) === 'emergency';
    return {
      handledBy: WaHandledBy.CRISIS,
      body: emergency
        ? withEmergencyLead(
            turn,
            emergencyReply({
              language: replyLanguageOf(turn.text, turn.language),
              organisation: chatbot.name,
              emergencyNumber: emergencyNumberFrom(
                await this.businessFacts(turn),
                crisisHelplines(turn.settings),
              ),
              selfHarm: Boolean(crisis.self_harm),
              animal: aboutAnAnimal(turn.text),
              kind: emergencyKindOf(turn.text),
              helplineNumbers: crisisHelplines(turn.settings) || null,
              india: isIndiaAssistant(chatbot.settings),
            }),
          )
        : crisisTextFor(turn),
      crisis: { level: emergency ? 2 : 1, path },
      retrievalMeta: { ...ran },
      alert: this.alert(
        200,
        'crisis',
        `${path === 'keyword' ? 'A crisis keyword rule matched' : 'The crisis classifier fired'} on chatbot "${chatbot.name}"${who} (${turn.channel.type}, ` +
          `sender ${sender.label}, confidence ${crisis.confidence.toFixed(2)}, signal ` +
          `"${crisis.signal}", ${emergency ? 'a medical emergency' : 'at risk'}). ${outcome}`,
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

  /**
   * The fixed run-failed reply (Q3-fast Part 0), in the person's language. How to reach the
   * business comes from its sources (the phone and email facts on its draft) or its helplines,
   * never its decline wording. A lookup failure only leaves the contact out.
   */
  private async runFailedText(turn: ChatTurn): Promise<string> {
    return runFailedReply(
      replyLanguageOf(turn.text, turn.language),
      turn.chatbot.name ?? '',
      contactFromSources(
        await this.businessFacts(turn),
        crisisHelplines(turn.settings),
      ),
    );
  }

  /**
   * The business's sourced facts (the site reader's and the owner's, on its draft), for the fixed
   * replies that name a number: the run-failed reply (Part 0) and the emergency reply (Part 1). A
   * lookup failure is no facts: the reply goes out without the number.
   */
  private businessFacts(turn: ChatTurn): Promise<ContactSource[]> {
    return businessFacts(this.documentRepository.manager, turn.chatbot.id);
  }

  /** The agent's answer, as one reply. */
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
