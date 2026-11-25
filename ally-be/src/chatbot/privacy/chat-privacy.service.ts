import { Injectable, Optional } from '@nestjs/common';
import { LoggerService } from '../../logger/logger.service';
import { WaHandledBy } from '../../whatsapp/enum/whatsapp.enum';
import type { Chatbot } from '../entity/chatbot.entity';
import type { ChatbotDecision } from '../engine/chatbot-engine.types';
import { replyLanguageOf, type ReplyLanguage } from '../engine/reply-language';
import { memorySettingsOf } from '../memory/memory-settings';
import { CustomerErasureService } from './customer-erasure.service';
import {
  ERASE_CANCELLED_COPY,
  ERASE_CONFIRM_COPY,
  eraseResultMessage,
} from './erase-copy';
import { eraseConfirmStep } from './erase-intent';
import { MemoryConsentService } from './memory-consent.service';
import { consentAnswerOf, consentWording } from './memory-consent-copy';
import { safetySettingsOf } from '../safety/safety-settings';

/**
 * Erase in chat (R5) and memory consent (D7) on a live channel (WhatsApp, the bot page): the
 * stage 5 hooks, in one place so both channels behave the same. Model-free: nothing here calls a
 * model, so it runs whatever the credit or access state, and never in the test pane (the engine
 * stays side-effect free; only channels call this).
 *
 * Order in a turn: STOP/START first (the channel), then the free crisis keyword check (a crisis
 * always wins, so a crisis message is never taken as an erase or consent answer), then
 * `beforeTurn`, then the engine. After a delivered reply, `consentQuestion`.
 */

export type PrivacyReplyKind =
  | 'erase_confirm'
  | 'erase_done'
  | 'erase_cancelled'
  | 'consent_recorded';

export interface PrivacyReply {
  kind: PrivacyReplyKind;
  body: string;
  /** Always a model-free fixed reply: stored as a template reply. */
  handledBy: WaHandledBy;
}

export interface PrivacyTurn {
  chatbot: Pick<Chatbot, 'id' | 'settings'>;
  /** chatbot_conversations.id (WhatsApp shares its ids with the shared store). */
  conversationId: string;
  /** The shared store's contact, when known. */
  contactId?: string | null;
  /** On WhatsApp the number authenticates the request (R5). */
  phone?: string | null;
  /** On the bot page, the signed-in visitor's verified email. */
  email?: string | null;
  text: string;
  language?: string | null;
  /** The free crisis keyword check matched: nothing here runs. */
  crisisKeyword: boolean;
}

// COPY: needs approval
export const CONSENT_RECORDED_COPY: Record<
  'granted' | 'declined',
  Record<ReplyLanguage, string>
> = {
  granted: {
    en: 'Thank you. I will remember what helps me help you. You can ask me to forget at any time.',
    hi: 'धन्यवाद। मैं वे बातें याद रखूँगा जो आपकी मदद में काम आएँ। आप कभी भी भूलने के लिए कह सकते हैं।',
    'hi-latn':
      'Dhanyavaad. Main woh baatein yaad rakhunga jo aapki madad mein kaam aayein. Aap kabhi bhi bhoolne ke liye keh sakte hain.',
  },
  declined: {
    en: 'OK. I will not remember anything from our chats.',
    hi: 'ठीक है। मैं हमारी बातचीत से कुछ भी याद नहीं रखूँगा।',
    'hi-latn':
      'Theek hai. Main hamari baatcheet se kuch bhi yaad nahin rakhunga.',
  },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Replies the agent itself made: the only ones a consent question may follow. */
const AGENT_REPLIES = new Set<string>([
  WaHandledBy.RAG,
  WaHandledBy.CLARIFIED,
  WaHandledBy.DECLINED,
]);

@Injectable()
export class ChatPrivacyService {
  private readonly logger = LoggerService.getInstance(ChatPrivacyService.name);

  constructor(
    @Optional() private readonly erasure?: CustomerErasureService,
    @Optional() private readonly consent?: MemoryConsentService,
  ) {}

  /**
   * Erase steps, then a consent answer. A fixed reply, or null to carry on with the engine. A
   * failure here never blocks the message: it is logged and the turn carries on.
   */
  async beforeTurn(turn: PrivacyTurn): Promise<PrivacyReply | null> {
    if (turn.crisisKeyword || !UUID.test(turn.conversationId ?? '')) {
      return null;
    }
    const language = replyLanguageOf(turn.text, turn.language);
    try {
      const erase = await this.eraseStep(turn, language);
      if (erase) return erase;
      return await this.consentAnswer(turn, language);
    } catch (error) {
      this.logger.warn(
        `Privacy step skipped on chatbot ${turn.chatbot.id}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      return null;
    }
  }

  private async eraseStep(
    turn: PrivacyTurn,
    language: ReplyLanguage,
  ): Promise<PrivacyReply | null> {
    if (!this.erasure) return null;
    const pending = await this.erasure.pendingFor(turn.conversationId);
    const step = eraseConfirmStep(pending, turn.text, language);
    switch (step.action) {
      case 'none':
        // An expired or ignored question is never acted on later.
        if (pending) await this.erasure.setPending(turn.conversationId, null);
        return null;
      case 'ask_confirm':
        await this.erasure.setPending(turn.conversationId, step.pending);
        return {
          kind: 'erase_confirm',
          body: ERASE_CONFIRM_COPY[language],
          handledBy: WaHandledBy.TEMPLATE,
        };
      case 'cancelled':
        await this.erasure.setPending(turn.conversationId, null);
        return {
          kind: 'erase_cancelled',
          body: ERASE_CANCELLED_COPY[language],
          handledBy: WaHandledBy.TEMPLATE,
        };
      case 'erase': {
        await this.erasure.setPending(turn.conversationId, null);
        const result = await this.erasure.eraseEndPerson(turn.chatbot.id, {
          contactId: turn.contactId ?? null,
          phone: turn.phone ?? null,
          email: turn.email ?? null,
        });
        return {
          kind: 'erase_done',
          body: eraseResultMessage(language, result),
          handledBy: WaHandledBy.TEMPLATE,
        };
      }
    }
  }

  /** A YES/NO to the consent question that is still open: stored, and acknowledged. */
  private async consentAnswer(
    turn: PrivacyTurn,
    language: ReplyLanguage,
  ): Promise<PrivacyReply | null> {
    if (!this.consent || !memorySettingsOf(turn.chatbot).on) return null;
    if (!turn.contactId || !UUID.test(turn.contactId)) return null;
    const answer = consentAnswerOf(turn.text);
    if (!answer) return null;
    const view = await this.consent.stateFor(turn.chatbot.id, turn.contactId);
    if (view.state !== 'asked') return null;
    // TF1: only a yes or no to the question itself, asked in the assistant's last message.
    if ((await this.consent.askedLast?.(turn.conversationId)) === false) {
      return null;
    }
    const version =
      view.wordingVersion ??
      consentWording(
        safetySettingsOf(turn.chatbot.settings as never).audienceAge,
        language,
      ).version;
    await this.consent.record(turn.chatbot.id, turn.contactId, answer, version);
    return {
      kind: 'consent_recorded',
      body: CONSENT_RECORDED_COPY[answer][language],
      handledBy: WaHandledBy.TEMPLATE,
    };
  }

  /**
   * The memory consent question to add after a delivered reply: only with memory on, for a known
   * contact who was never asked, after the agent's own answer (never a crisis, blocked, off,
   * held or hand-over reply). Recorded as asked, so it is asked once.
   */
  async consentQuestion(input: {
    chatbot: Pick<Chatbot, 'id' | 'settings'>;
    contactId?: string | null;
    decision: Pick<ChatbotDecision, 'handledBy' | 'blocked' | 'off' | 'held'>;
    text: string;
    language?: string | null;
  }): Promise<string | null> {
    const { chatbot, contactId, decision } = input;
    if (!this.consent || !memorySettingsOf(chatbot).on) return null;
    if (!contactId || !UUID.test(contactId)) return null;
    if (
      decision.blocked ||
      decision.off ||
      decision.held ||
      !AGENT_REPLIES.has(decision.handledBy)
    ) {
      return null;
    }
    try {
      const view = await this.consent.stateFor(chatbot.id, contactId);
      if (view.state !== 'unasked') return null;
      const asked = await this.consent.ask(
        chatbot.id,
        contactId,
        replyLanguageOf(input.text, input.language),
      );
      return asked?.text ?? null;
    } catch (error) {
      this.logger.warn(
        `Consent question skipped on chatbot ${chatbot.id}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      return null;
    }
  }
}
