import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { LoggerService } from '../../logger/logger.service';
import { RedisService } from '../../redis/service/redis.service';
import {
  OFFER_TTL_S,
  isPlainYes,
  questionShown,
  type OfferQuestions,
  type WriteOffer,
} from './list-consent';

/**
 * Where the offers wait (chunk H1 Part B): one per conversation, the latest, in Redis for a day. A
 * Redis failure fails closed: no offer is accepted, so nothing is written without a yes.
 */
@Injectable()
export class ListConsentService {
  private readonly logger = LoggerService.getInstance(ListConsentService.name);

  constructor(private readonly redis: RedisService) {}

  private key(chatbotId: string, conversationId: string): string {
    return `agent:offer:${chatbotId}:${conversationId}`;
  }

  async current(
    chatbotId: string,
    conversationId: string,
  ): Promise<WriteOffer | null> {
    try {
      const raw = await this.redis.get(this.key(chatbotId, conversationId));
      return raw ? (JSON.parse(raw) as WriteOffer) : null;
    } catch (error) {
      this.logger.warn(
        `Could not read the pending offer: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      return null;
    }
  }

  /**
   * The offer this turn may act on, for the run token: the stored one, when the person's message is
   * a plain yes and the assistant's previous message carried its question. Otherwise null.
   */
  async consentFor(
    chatbotId: string,
    conversationId: string,
    message: string,
    previousAssistant: string | null | undefined,
  ): Promise<string | null> {
    if (!isPlainYes(message)) return null;
    const offer = await this.current(chatbotId, conversationId);
    if (!offer || !questionShown(previousAssistant, offer.questions)) {
      return null;
    }
    return offer.id;
  }

  /** Store what this run would write, replacing any earlier offer. */
  async offer(
    ctx: { chatbotId: string; conversationId: string; runId: string },
    tool: string,
    key: string,
    list: string,
    questions: OfferQuestions,
  ): Promise<WriteOffer> {
    const offer: WriteOffer = {
      id: randomUUID(),
      runId: ctx.runId,
      tool,
      key,
      list,
      questions,
      createdAt: Date.now(),
    };
    try {
      await this.redis.set(
        this.key(ctx.chatbotId, ctx.conversationId),
        JSON.stringify(offer),
        OFFER_TTL_S,
      );
    } catch (error) {
      this.logger.warn(
        `Could not store the offer: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
    return offer;
  }

  /**
   * Whether this write is the one the person said yes to: the token names the stored offer, the
   * offer was made in an earlier run, and the write is exactly what it named.
   */
  async accepts(
    ctx: {
      chatbotId: string;
      conversationId: string;
      runId: string;
      consentOfferId?: string | null;
    },
    tool: string,
    key: string,
  ): Promise<WriteOffer | null> {
    if (!ctx.consentOfferId) return null;
    const offer = await this.current(ctx.chatbotId, ctx.conversationId);
    if (
      !offer ||
      offer.id !== ctx.consentOfferId ||
      offer.runId === ctx.runId ||
      offer.tool !== tool ||
      offer.key !== key
    ) {
      return null;
    }
    return offer;
  }

  /** The yes is used: one yes, one write. */
  async consume(chatbotId: string, conversationId: string): Promise<void> {
    try {
      await this.redis.del(this.key(chatbotId, conversationId));
    } catch (error) {
      this.logger.warn(
        `Could not clear the offer: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }
}
