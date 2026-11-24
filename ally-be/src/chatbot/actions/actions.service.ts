import { Injectable, Optional } from '@nestjs/common';
import { AgentRuntimeUsed } from '../enum/chatbot.enum';
import type { AgentActivity } from '../../ai/dto/knowledge.dto';
import { WaHandledBy } from '../../whatsapp/enum/whatsapp.enum';
import {
  AgentGatewayService,
  tapRunIdFor,
} from '../agent-tools/agent-gateway.service';
import { ListConsentService } from '../agent-tools/list-consent.service';
import type { WriteOffer } from '../agent-tools/list-consent';
import { ListToolsService } from '../agent-tools/list-tools.service';
import type { CardHeadline } from '../agent-tools/entry-words';
import { replyLanguageOf } from '../engine/reply-language';
import type { ReplyLanguage } from '../engine/reply-language';
import type { ChatTurn, ChatbotDecision } from '../engine/chatbot-engine.types';
import { DONE_LINE, TAP_REPLY, fillCopy } from './action-copy';
import type { ReplyParts } from './action-parts.service';
import { ActionTokenService } from './action-token.service';

/** What a tap answered in code returns: the reply, and parts to show instead of the run's. */
export type TapDecision = ChatbotDecision & { parts?: ReplyParts };

/**
 * Answers a tap in code (BT1 §2), after the engine's gates (the crisis keyword check, access,
 * credits, an off chatbot) have run on it as on a typed message:
 * - Confirm writes the offer the card showed through the gateway (same tool, list rules,
 *   per-person scope, consent, idempotency), with no model call, and returns the done line;
 * - Keep it drops the pending cancel;
 * - a button that no longer works says so.
 * Every other tap returns null: the engine answers it like the words it stands for.
 */
@Injectable()
export class ActionsService {
  constructor(
    private readonly gateway: AgentGatewayService,
    private readonly listTools: ListToolsService,
    private readonly tokens: ActionTokenService,
    @Optional() private readonly consent?: ListConsentService,
  ) {}

  /** Redeems a token for a channel, which then stores the tap's words as the person's message. */
  redeem(
    token: string,
    where: {
      chatbotId: string;
      conversationId: string;
      contactId: string | null;
    },
  ): ReturnType<ActionTokenService['redeem']> {
    return this.tokens.redeem(token, where);
  }

  /** A crisis reply went out: the pending write is dropped (BT1, crisis between taps). */
  async forgetOffer(chatbotId: string, conversationId: string): Promise<void> {
    await this.consent?.consume(chatbotId, conversationId);
  }

  async perform(turn: ChatTurn): Promise<TapDecision | null> {
    const tap = turn.tap;
    if (!tap) return null;
    const language = replyLanguageOf(turn.text ?? '', turn.language);
    const words = TAP_REPLY[language];
    if (!tap.ok) {
      return {
        handledBy: WaHandledBy.TAP,
        body: tap.reason === 'not_yours' ? words.notYours : words.expired,
      };
    }
    const { claims, firstUse } = tap;
    if (claims.kind === 'confirm' && claims.offer) {
      return this.confirm(turn, claims.offer, language);
    }
    if (!firstUse) {
      return { handledBy: WaHandledBy.TAP, body: words.already };
    }
    if (claims.kind === 'keep') {
      await this.consent?.consume(turn.chatbot.id, turn.conversationId ?? '');
      return { handledBy: WaHandledBy.TAP, body: words.kept };
    }
    // choose, change, cancel, move, ask: the agent answers the words the tap stands for.
    return null;
  }

  private async confirm(
    turn: ChatTurn,
    offer: WriteOffer,
    language: ReplyLanguage,
  ): Promise<TapDecision> {
    const words = TAP_REPLY[language];
    const conversationId = turn.conversationId ?? '';
    const contactId = turn.contactId ?? null;
    const outcome = await this.gateway.confirmOffer(
      { chatbotId: turn.chatbot.id, conversationId, contactId },
      offer,
    );
    const runId = tapRunIdFor(offer.id);
    if (outcome.ok) {
      const passage = (
        outcome.result.passages as { record_id?: string }[] | undefined
      )?.[0];
      const card = offer.card!;
      const headline: CardHeadline =
        card.action === 'cancel'
          ? 'cancelled'
          : card.action === 'update'
            ? 'changed'
            : card.headline;
      const stored = passage?.record_id
        ? await this.listTools.confirmation(
            turn.chatbot.id,
            passage.record_id,
            contactId,
            runId,
          )
        : null;
      const shown = stored ?? card;
      const activity: AgentActivity = {
        kind: card.action,
        list: card.list,
        title: shown.title,
        ...(passage?.record_id ? { record_id: passage.record_id } : {}),
      };
      return {
        handledBy: WaHandledBy.TAP,
        body: fillCopy(DONE_LINE[language][headline], {
          what: whatOf(shown),
        }),
        agent: {
          runtime: AgentRuntimeUsed.V2,
          runId,
          conversationId,
          trace: [],
          activity: [activity],
        },
        tapDone: {
          action: card.action,
          list: shown.list,
          title: shown.title,
          headline,
          details: shown.details,
        },
      };
    }
    // The entry was taken, or a rule refused it, between the card and the tap: say so. The free
    // entries the refusal found come back as chips (`ActionPartsService`, from this tap's run).
    const result = (outcome.result ?? {}) as {
      message?: string;
      question?: string;
      passages?: { record_id?: string }[];
    };
    const ref: NonNullable<ChatbotDecision['agent']> = {
      runtime: AgentRuntimeUsed.V2,
      runId,
      conversationId,
      trace: [],
    };
    if (outcome.error === 'needs_confirmation') {
      // What would be written changed since the card (a detail filled in): a new card, asked again.
      return {
        handledBy: WaHandledBy.TAP,
        body: result.question ?? words.expired,
        agent: ref,
      };
    }
    const free = (result.passages ?? []).filter((p) => p.record_id);
    return {
      handledBy: WaHandledBy.TAP,
      body: free.length
        ? words.taken
        : result.message
          ? fillCopy(words.refused, { reason: result.message })
          : words.expired,
      agent: ref,
    };
  }
}

/** "Sun 29 Nov 2026, 11:00, Bandra West station": the card's when and where, else its title. */
function whatOf(card: {
  title: string;
  details: { label: string; value: string }[];
}): string {
  const when = card.details.find((d) => d.label === 'When')?.value;
  const where = card.details.find((d) => d.label === 'Where')?.value;
  return [when ?? card.title, where].filter(Boolean).join(', ');
}
