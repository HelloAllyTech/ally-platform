import { Injectable, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Observable, ReplaySubject, startWith } from 'rxjs';
import { Repository } from 'typeorm';
import { SseMessageEvent } from '../../ai-chat/service/ai-chat.service';
import { LlmProviderFactory } from '../../ai-chat/provider/llm-provider.factory';
import { LlmUsageService } from '../../analytics/service/llm-usage.service';
import {
  DEBRIEF_REFLECTION_CHECK_SYSTEM,
  DEBRIEF_REPLY_SYSTEM,
} from '../../prompt/contracts/prompt-contracts';
import {
  PromptInputs,
  renderPrompt,
  toStoreContract,
} from '../../prompt/contracts/define-prompt';
import { placeholdersIn } from '../../prompt/util/prompt-contract.util';
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
import { LoggerService } from '../../logger/logger.service';
import { PromptSharedService } from '../../prompt/service/prompt-shared.service';
import {
  DEBRIEF_MAX_REPLIES_DEFAULT,
  DEBRIEF_MIN_REPLY_USD,
  DEBRIEF_PROMPT_CODES,
  DEBRIEF_REFLECTION_CHECK_MODEL,
  DEBRIEF_REPLY_BUDGET_MAX,
  DEBRIEF_REPLY_DEFAULT,
  DEBRIEF_SESSION_BUDGET_DEFAULT,
} from '../constants/debrief-release.constants';
import { modelPrices } from '../util/debrief-budget.util';
import {
  DebriefCards,
  cardTexts,
  REPLY_MAX_WORDS,
  defaultClinicalPatterns,
  replyCheckFailures,
  cardSkills,
  speakerRuns,
  unmatchedQuotes,
} from '../util/debrief-cards.util';
import { DebriefClinicalListsService } from './debrief-clinical-lists.service';
import { AskAllyClient, AskAllyError, ReplyTrace } from './ask-ally.client';
import { DebriefAgentService } from './debrief-agent.service';
import { DebriefContextRepository } from './debrief-context.repository';
import { CHECK_FALLBACK } from '../constants/debrief-reply.constants';
import { DebriefFeedbackService } from './debrief-feedback.service';
import { DebriefLearnerEventsService } from './debrief-learner-events.service';
import { DebriefRunnerService } from './debrief-runner.service';
import { DebriefRunTokenService } from './debrief-run-token.service';

/** The chat's assistant sender, as today's debrief chat stores it. */
const ALLY_SENDER = -1;
/** Verbatim turns sent with each reply; the debrief carries the rest. */
const HISTORY_TURNS = 10;

/** Shown in place of a reply that failed a check: honest, never the failed text. */

/** "If you'd like to talk to someone now:", the debrief's own distress copy. */
const SUPPORT_LEAD: Record<string, string> = {
  en: "If you'd like to talk to someone now:",
  hi: 'अगर आप अभी किसी से बात करना चाहें:',
  kn: 'ಈಗ ಯಾರಾದರೂ ಜೊತೆ ಮಾತನಾಡಲು ಇಚ್ಛಿಸಿದರೆ:',
  mr: 'आता कुणाशी बोलायचं वाटत असेल तर:',
  ta: 'இப்போது யாரிடமாவது பேச விரும்பினால்:',
};

/**
 * Why Ask Ally stopped taking questions, in the debrief's language: this
 * session's budget or reply limit is used up, or this month's debrief budget
 * is spent. The learner keeps reading their debrief either way.
 */
export const REPLY_LIMIT: Record<
  'session' | 'month',
  Record<string, string>
> = {
  session: {
    en: "That's all the questions I can take on this debrief. Your debrief stays here to read, and you can ask me about your next one.",
    hi: 'इस डीब्रीफ़ पर मैं इतने ही सवाल ले सकती हूँ। आपकी डीब्रीफ़ यहीं पढ़ने के लिए रहेगी, और अगली डीब्रीफ़ के बारे में आप मुझसे फिर पूछ सकते हैं।',
    kn: 'ಈ ಡೀಬ್ರೀಫ್ ಬಗ್ಗೆ ನಾನು ಇಷ್ಟೇ ಪ್ರಶ್ನೆಗಳನ್ನು ತೆಗೆದುಕೊಳ್ಳಬಹುದು. ನಿಮ್ಮ ಡೀಬ್ರೀಫ್ ಇಲ್ಲೇ ಓದಲು ಇರುತ್ತದೆ, ಮುಂದಿನ ಡೀಬ್ರೀಫ್ ಬಗ್ಗೆ ನನ್ನನ್ನು ಮತ್ತೆ ಕೇಳಬಹುದು.',
    mr: 'या डीब्रीफवर मी इतकेच प्रश्न घेऊ शकते. तुमची डीब्रीफ इथेच वाचायला राहील, आणि पुढच्या डीब्रीफबद्दल तुम्ही मला पुन्हा विचारू शकता.',
    ta: 'இந்த டீப்ரீஃப் பற்றி இவ்வளவு கேள்விகளே என்னால் எடுக்க முடியும். உங்கள் டீப்ரீஃப் இங்கேயே படிக்க இருக்கும், அடுத்த டீப்ரீஃப் பற்றி என்னிடம் மீண்டும் கேட்கலாம்.',
  },
  month: {
    en: "I can't take more questions just now. Your debrief stays here to read; please try asking again later.",
    hi: 'अभी मैं और सवाल नहीं ले सकती। आपकी डीब्रीफ़ यहीं पढ़ने के लिए रहेगी; कृपया बाद में फिर पूछें।',
    kn: 'ಈಗ ನಾನು ಇನ್ನಷ್ಟು ಪ್ರಶ್ನೆಗಳನ್ನು ತೆಗೆದುಕೊಳ್ಳಲು ಆಗುವುದಿಲ್ಲ. ನಿಮ್ಮ ಡೀಬ್ರೀಫ್ ಇಲ್ಲೇ ಓದಲು ಇರುತ್ತದೆ; ದಯವಿಟ್ಟು ನಂತರ ಮತ್ತೆ ಕೇಳಿ.',
    mr: 'आत्ता मी आणखी प्रश्न घेऊ शकत नाही. तुमची डीब्रीफ इथेच वाचायला राहील; कृपया नंतर पुन्हा विचारा.',
    ta: 'இப்போது மேலும் கேள்விகளை என்னால் எடுக்க முடியாது. உங்கள் டீப்ரீஃப் இங்கேயே படிக்க இருக்கும்; தயவுசெய்து பிறகு மீண்டும் கேளுங்கள்.',
  },
};

/**
 * Whether Ask Ally may answer one more question in this session, and with
 * how much: the session's budget covers its debrief run and every reply
 * before this one; the month's cap covers every session. Pure, for tests.
 */
export function replyAllowance(input: {
  sessionBudgetUsd: number;
  maxReplies: number;
  runCostUsd: number;
  askAllySpentUsd: number;
  repliesSoFar: number;
  monthSpentUsd: number;
  monthlyCapUsd: number;
  replyBudgetUsd: number;
}):
  | { ok: true; budgetUsd: number }
  | { ok: false; reason: 'session' | 'month' } {
  if (input.monthSpentUsd >= input.monthlyCapUsd) {
    return { ok: false, reason: 'month' };
  }
  if (input.repliesSoFar >= input.maxReplies) {
    return { ok: false, reason: 'session' };
  }
  const left =
    input.sessionBudgetUsd - input.runCostUsd - input.askAllySpentUsd;
  if (left < DEBRIEF_MIN_REPLY_USD) return { ok: false, reason: 'session' };
  return {
    ok: true,
    budgetUsd: Math.min(
      input.replyBudgetUsd,
      DEBRIEF_REPLY_BUDGET_MAX,
      left,
      input.monthlyCapUsd - input.monthSpentUsd,
    ),
  };
}

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
 * Safety reader reads each message alongside the reply, inside Ask Ally's
 * request to ally-ai, for distress the keywords miss; its verdict comes back
 * on the reply's last event, and this service adds the support lines and the
 * review item when it finds some. A reply that fails the code checks is replaced, not shown.
 *
 * The reply itself is Ask Ally's agent in ally-ai (CONTRACT.md §5): a
 * LangGraph tool loop that looks up guidance, the learner's history and the
 * live detector's record through the Debrief gateway, with a reply token.
 * This service keeps everything around it: the screens, the checks, the
 * thread, and the SSE relay.
 */
/** What the learner sees each part of a debrief called (English; the rest are translations). */
const CARD_SECTION_NAMES = [
  'An important moment',
  'What worked',
  'Work on this',
  'Try saying',
  'Practise this next',
  'One question to think about',
];

/**
 * The word cap, sent last, after the debrief, transcript and context: from the
 * top of a long prompt the model drifted (a 190-word reply in the prod
 * end-to-end check, 2 Nov 2026). Data only: how to write short is the reply
 * prompt's LENGTH section (Skills Store), and `replyCheckFailures` fails a
 * reply over the cap.
 */
export const REPLY_LENGTH_REMINDER = `REPLY LIMIT: ${REPLY_MAX_WORDS} words.`;

/**
 * The reply's system text: the live `debrief_reply_system` with its
 * `{{name}}` placeholders filled (step 5). Throws, naming the prompt and the
 * variables, when the live text lacks one the contract requires.
 */
export function renderReplySystem(
  template: string,
  inputs: PromptInputs<typeof DEBRIEF_REPLY_SYSTEM>,
): string {
  const used = new Set(placeholdersIn(template));
  const missing = (toStoreContract(DEBRIEF_REPLY_SYSTEM).required ?? []).filter(
    (v) => !used.has(v),
  );
  if (missing.length) {
    throw new Error(
      `prompt ${DEBRIEF_REPLY_SYSTEM.code} is missing required variable(s) ${missing
        .map((v) => `{{${v}}}`)
        .join(', ')}`,
    );
  }
  return renderPrompt(DEBRIEF_REPLY_SYSTEM, template, inputs);
}

/** The organisation's wording must arrive within this, or is left out. */
const ORG_WORDING_MS = 1200;
/** Shown when Ask Ally could not answer and no words had reached the learner. */
export const REPLY_FAILED =
  'Ally could not answer just now. Please try again in a moment.';

@Injectable()
export class DebriefReplyService {
  private readonly logger = LoggerService.getInstance(DebriefReplyService.name);

  constructor(
    @InjectRepository(ScenarioSessionChat)
    private readonly chats: Repository<ScenarioSessionChat>,
    @InjectRepository(ScenarioSessionChatMessage)
    private readonly messages: Repository<ScenarioSessionChatMessage>,
    private readonly context: DebriefContextRepository,
    private readonly runner: DebriefRunnerService,
    private readonly agent: DebriefAgentService,
    private readonly feedback: DebriefFeedbackService,
    private readonly crisis: GuideCrisisService,
    private readonly prompts: PromptSharedService,
    private readonly events: EventEmitter2,
    private readonly llm: LlmProviderFactory,
    private readonly usage: LlmUsageService,
    private readonly askAlly: AskAllyClient,
    private readonly tokens: DebriefRunTokenService,
    /** v9 §3.3: replies and reflective answers, for the experience metrics. */
    @Optional() private readonly learnerEvents?: DebriefLearnerEventsService,
    /** Settings › Clinical lists; the defaults when absent or unreadable. */
    @Optional() private readonly clinicalLists?: DebriefClinicalListsService,
  ) {}

  async stream(
    sessionId: string,
    userId: number,
    message: string,
    opts: { section?: string | null } = {},
  ): Promise<Observable<SseMessageEvent>> {
    const startedAt = Date.now();
    let firstWordsMs: number | null = null;
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
    void this.learnerEvents?.record({
      sessionId,
      userId,
      kind: 'replied',
      tenantId,
      runId: run.id,
    });

    // Replayed: the crisis reply, and a fast model, can emit before the
    // controller has subscribed, and nothing the learner should see is lost.
    const subject = new ReplaySubject<SseMessageEvent>();
    const finish = async (content: string, limit?: 'session' | 'month') => {
      subject.next(
        event({
          type: 'done',
          content,
          citations: [],
          ...(limit ? { limit } : {}),
        }),
      );
      subject.complete();
      // For the Console's Ask Ally tab: which card it was about (when the app
      // says), and how long the learner waited for the first words.
      // The learner view closes Ask Ally on reload too (`askAlly`).
      if (limit) void this.keepReplyLimit(run.id, limit);
      void this.keepReplyMeta(run.id, {
        at: new Date().toISOString(),
        section: opts.section?.trim() ? opts.section.trim().slice(0, 48) : null,
        firstWordsMs: firstWordsMs ?? Date.now() - startedAt,
      });
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

    // Guidance, the learner's history and the live detector's record are
    // tools Ask Ally calls when a question needs them; only the
    // organisation's short wording is sent up front.
    const [transcript, system, safetySystem, { bundle }, org] =
      await Promise.all([
        this.context.transcript(sessionId),
        this.systemPrompt(),
        this.systemPrompt(DEBRIEF_PROMPT_CODES.safetyReader),
        this.runner.resolveRelease(),
        this.orgContext(tenantId),
      ]);
    // The release names Ask Ally's model, as it names every step's.
    const released = bundle.reply ?? DEBRIEF_REPLY_DEFAULT;
    // Sandeep's session budget (2026-11-16): the run and every reply share
    // one budget, replies are counted, and the month's cap applies here too.
    // When any is used up the learner gets a plain "no more questions" in
    // their language, never an error and never a model call.
    const month = await this.context.monthToDate();
    const allowance = replyAllowance({
      sessionBudgetUsd:
        bundle.settings.sessionBudgetUsd ?? DEBRIEF_SESSION_BUDGET_DEFAULT,
      maxReplies:
        bundle.settings.maxRepliesPerSession ?? DEBRIEF_MAX_REPLIES_DEFAULT,
      runCostUsd: Number(run.actualCostUsd ?? run.estimatedCostUsd ?? 0),
      askAllySpentUsd: Number(run.workspace?.askAllySpentUsd ?? 0),
      repliesSoFar: prior.filter((m) => m.senderId === ALLY_SENDER).length,
      monthSpentUsd: month.spentUsd,
      monthlyCapUsd: bundle.settings.monthlyCapUsd,
      replyBudgetUsd: released.budgetUsd ?? DEBRIEF_REPLY_BUDGET_MAX,
    });
    if (!allowance.ok) {
      this.logger.warn(
        `[debrief] Ask Ally limit for run ${run.id}: ${allowance.reason}`,
      );
      const copy = REPLY_LIMIT[allowance.reason];
      void finish(copy[language] ?? copy.en, allowance.reason);
      return subject.pipe(startWith(event({ type: 'start' })));
    }
    const model = { ...released, budgetUsd: allowance.budgetUsd };
    // Plan §8.9 (FR-57): never to a provider the organisation doesn't allow.
    // No fallback model: the learner gets the usual "try again" instead.
    const allowed = await this.context.providerAllowlist(tenantId);
    if (!allowed.includes(model.provider)) {
      this.logger.warn(
        `[debrief] Ask Ally for run ${run.id}: ${model.provider} is not on this organisation's provider allowlist`,
      );
      // After the caller has subscribed, like every other ending.
      setTimeout(() => {
        subject.next(event({ type: 'error', error: REPLY_FAILED }));
        subject.complete();
      }, 0);
      return subject.pipe(startWith(event({ type: 'start' })));
    }
    const sources = [
      ...speakerRuns(transcript),
      ...org,
      ...cardTexts(run.cards as unknown as DebriefCards).map((c) => c.text),
      // A card's skill is its name ("Giving Advice"), and Ally quotes it
      // when it names the card.
      ...cardSkills(run.cards as unknown as DebriefCards),
      // The learner's own words in this thread, and the card names they
      // read: echoing either back in quotes is not a misquote.
      message,
      ...prior.filter((m) => m.senderId !== ALLY_SENDER).map((m) => m.content),
      ...CARD_SECTION_NAMES,
    ];

    let systemPrompt: string;
    try {
      systemPrompt = renderReplySystem(system, {
        session_language: language,
        debrief: JSON.stringify(run.cards),
        transcript: transcript.map((t) => `${t.role}: ${t.text}`).join('\n'),
        organisation: org[1] ?? 'none',
        reply_word_limit: REPLY_MAX_WORDS,
      });
    } catch (e) {
      // The live reply prompt lacks a variable the code requires (step 5):
      // loud, naming the code and the variable; the learner gets "try again".
      this.logger.error(
        `[debrief] Ask Ally for run ${run.id}: ${(e as Error).message}`,
      );
      setTimeout(() => {
        subject.next(event({ type: 'error', error: REPLY_FAILED }));
        subject.complete();
      }, 0);
      return subject.pipe(startWith(event({ type: 'start' })));
    }
    // Both names: the web reads `text`, the phones read `content`.
    const token = (text: string) => {
      if (firstWordsMs == null) firstWordsMs = Date.now() - startedAt;
      subject.next(event({ type: 'token', content: text, text }));
    };

    /** The finished reply: checked, distress-screened, then sent and saved. */
    const settle = async (full: string, distress: boolean) => {
      const clinical =
        (await this.clinicalLists?.patterns(language).catch(() => null)) ??
        defaultClinicalPatterns(language);
      const fails = replyCheckFailures(full, sources, clinical);
      let content = fails.length ? CHECK_FALLBACK : full;
      if (fails.length) {
        this.logger.warn(
          `[debrief] Ask Ally reply replaced for run ${run.id}: ${fails.join(', ')}`,
        );
        void this.keepReplaced(run.id, {
          at: new Date().toISOString(),
          fails,
          unmatched: unmatchedQuotes(full, sources),
          reply: full,
        });
      }
      if (distress) {
        void this.feedback.raiseChatDistress(run, userId, 'safety reader');
        content += `\n\n${await this.supportReply(tenantId, language, false)}`;
      }
      await finish(content);
    };

    // v9 FR-43: the reply as a small agent in ally-ai that looks up what a
    // question needs within its pass and dollar limits.
    void (async () => {
      let streamed = '';
      try {
        const res = await this.askAlly.reply(
          {
            run_id: run.id,
            scenario_session_id: sessionId,
            chat_id: chat.id,
            tenant_id: tenantId ?? null,
            reply: model,
            prices: modelPrices([model.model]),
            system: systemPrompt,
            history: this.history(prior),
            message,
            run_token: this.tokens.signReply(run.id, sessionId, userId),
            gateway_url: this.tokens.gatewayUrl(),
            // The Safety reader reads the message alongside the reply, in
            // ally-ai; first words never wait for it.
            language,
            safety_system: safetySystem || null,
          },
          (text) => {
            streamed += text;
            token(text);
          },
        );
        // A quote from what a tool returned is not a misquote.
        sources.push(...res.toolTexts);
        if (res.trace) {
          void this.keepReplyTrace(run.id, res.trace);
          void this.addReplySpend(run.id, res.trace.costUsd);
        }
        await settle(res.text, res.distress);
      } catch (e) {
        this.logger.warn(
          `[debrief] Ask Ally failed for run ${run.id}: ${(e as Error).message}`,
        );
        if (e instanceof AskAllyError && e.trace) {
          void this.keepReplyTrace(run.id, e.trace);
          void this.addReplySpend(run.id, e.trace.costUsd);
        }
        // A reply that failed before its last event carries no verdict: the
        // keyword screen already ran, and a failed read adds nothing.
        const distress = e instanceof AskAllyError && e.distress;
        if (streamed) {
          // Words already reached the learner: finish with what they saw.
          await settle(streamed, distress);
        } else if (distress) {
          // No reply, but the Safety reader heard distress: the support
          // lines still reach them.
          void this.feedback.raiseChatDistress(run, userId, 'safety reader');
          await finish(await this.supportReply(tenantId, language, false));
        } else {
          subject.next(event({ type: 'error', error: REPLY_FAILED }));
          subject.complete();
        }
      }
    })();
    return subject.pipe(startWith(event({ type: 'start' })));
  }

  /**
   * How a reply was reached — the tools it called (a guidance topic, never
   * the learner's message), its passes and cost — kept on the run (the last
   * 20) for the Console's run view. Never throws.
   */
  private async keepReplyTrace(
    runId: string,
    trace: ReplyTrace,
  ): Promise<void> {
    try {
      await this.chats.manager.query(
        `UPDATE debrief_runs
            SET workspace = jsonb_set(
              coalesce(workspace, '{}'::jsonb), '{replyTraces}',
              (SELECT coalesce(jsonb_agg(x.e ORDER BY x.n), '[]'::jsonb)
                 FROM jsonb_array_elements(
                        coalesce(workspace->'replyTraces', '[]'::jsonb) || jsonb_build_array($2::jsonb)
                      ) WITH ORDINALITY AS x(e, n)
                WHERE x.n > jsonb_array_length(coalesce(workspace->'replyTraces', '[]'::jsonb)) + 1 - 20))
          WHERE id = $1`,
        [runId, JSON.stringify(trace)],
      );
    } catch (e) {
      this.logger.warn(
        `[debrief] could not keep a reply trace for run ${runId}: ${(e as Error).message}`,
      );
    }
  }

  /**
   * What Ask Ally has spent on this session, added to on every reply that
   * reports a cost: the session budget and the month's spend read it. The
   * traces keep only the last 20, so the total lives apart. Never throws.
   */
  private async addReplySpend(runId: string, costUsd: number): Promise<void> {
    if (!Number.isFinite(costUsd) || costUsd <= 0) return;
    try {
      await this.chats.manager.query(
        `UPDATE debrief_runs
            SET workspace = jsonb_set(
              coalesce(workspace, '{}'::jsonb), '{askAllySpentUsd}',
              to_jsonb(round((coalesce((workspace->>'askAllySpentUsd')::numeric, 0) + $2::numeric), 6)))
          WHERE id = $1`,
        [runId, costUsd],
      );
    } catch (e) {
      this.logger.warn(
        `[debrief] could not add Ask Ally spend for run ${runId}: ${(e as Error).message}`,
      );
    }
  }

  /** Each reply's card and time to first words, kept on the run (the last 50). Never throws. */
  /**
   * Ask Ally answered with its limit message: marked on the run
   * (`workspace.askAllyLimit`), so the learner view says the reply box is
   * closed after a reload instead of the apps guessing from the text.
   * Never throws.
   */
  private async keepReplyLimit(
    runId: string,
    reason: 'session' | 'month',
  ): Promise<void> {
    try {
      await this.chats.manager.query(
        `UPDATE debrief_runs
            SET workspace = jsonb_set(coalesce(workspace, '{}'::jsonb), '{askAllyLimit}',
                  jsonb_build_object('reason', $2::text, 'at', now()), true)
          WHERE id = $1`,
        [runId, reason],
      );
    } catch (e) {
      this.logger.warn(
        `[debrief] could not mark the Ask Ally limit for run ${runId}: ${(e as Error).message}`,
      );
    }
  }

  private async keepReplyMeta(
    runId: string,
    entry: { at: string; section: string | null; firstWordsMs: number },
  ): Promise<void> {
    try {
      await this.chats.manager.query(
        `UPDATE debrief_runs
            SET workspace = jsonb_set(
              coalesce(workspace, '{}'::jsonb), '{replyMeta}',
              (SELECT coalesce(jsonb_agg(x.e ORDER BY x.n), '[]'::jsonb)
                 FROM jsonb_array_elements(
                        coalesce(workspace->'replyMeta', '[]'::jsonb) || jsonb_build_array($2::jsonb)
                      ) WITH ORDINALITY AS x(e, n)
                WHERE x.n > jsonb_array_length(coalesce(workspace->'replyMeta', '[]'::jsonb)) + 1 - 50))
          WHERE id = $1`,
        [runId, JSON.stringify(entry)],
      );
    } catch (e) {
      this.logger.warn(
        `[debrief] could not keep reply timing for run ${runId}: ${(e as Error).message}`,
      );
    }
  }

  /**
   * A reply the checks replaced, kept on the run (the last 20) so a person
   * can see what was wrong: the words stay in the database beside the
   * transcript, never in the logs. Never throws.
   */
  private async keepReplaced(
    runId: string,
    entry: { at: string; fails: string[]; unmatched: string[]; reply: string },
  ): Promise<void> {
    try {
      await this.chats.manager.query(
        `UPDATE debrief_runs
            SET workspace = jsonb_set(
              coalesce(workspace, '{}'::jsonb), '{replacedReplies}',
              (SELECT coalesce(jsonb_agg(x.e ORDER BY x.n), '[]'::jsonb)
                 FROM jsonb_array_elements(
                        coalesce(workspace->'replacedReplies', '[]'::jsonb) || jsonb_build_array($2::jsonb)
                      ) WITH ORDINALITY AS x(e, n)
                WHERE x.n > jsonb_array_length(coalesce(workspace->'replacedReplies', '[]'::jsonb)) + 1 - 20))
          WHERE id = $1`,
        [runId, JSON.stringify(entry)],
      );
    } catch (e) {
      this.logger.warn(
        `[debrief] could not keep a replaced reply for run ${runId}: ${(e as Error).message}`,
      );
    }
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
            void this.learnerEvents?.record({
              sessionId: run.scenarioSessionId,
              userId,
              kind: 'reflection_answered',
              tenantId: params.tenantId,
              runId: (run as { id?: string }).id ?? null,
            });
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

  /**
   * The organisation's wording (how to refer to their supervisor or its
   * procedures), sent with every reply. Left out when slow or failing: the
   * first words must stay fast.
   */
  private async orgContext(tenantId: string | null): Promise<string[]> {
    if (!tenantId) return [];
    let org: string | null = null;
    try {
      org = await Promise.race([
        this.context.orgWording(tenantId),
        new Promise<null>((r) => {
          setTimeout(() => r(null), ORG_WORDING_MS).unref?.();
        }),
      ]);
    } catch {
      org = null;
    }
    return org
      ? [
          // Data: how to use it is the reply prompt's THEIR ORGANISATION.
          'THEIR ORGANISATION:',
          org,
        ]
      : [];
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
  private history(
    prior: ScenarioSessionChatMessage[],
  ): Array<{ role: 'user' | 'assistant'; content: string }> {
    return prior.slice(-HISTORY_TURNS).map((m) => ({
      role:
        m.senderId === ALLY_SENDER ? ('assistant' as const) : ('user' as const),
      content: m.content,
    }));
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
