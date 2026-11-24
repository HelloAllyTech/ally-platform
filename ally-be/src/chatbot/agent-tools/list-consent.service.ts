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

/** A turn's context lives as long as a run can. */
const TURN_TTL_S = 120;

/**
 * Where the offers wait (chunk H1 Part B): one per conversation, the latest, in Redis for a day. A
 * Redis failure fails closed: no offer is accepted, so nothing is written without a yes.
 */
/** How long Try it's test bookings hold their slots (Q4 B4). */
export const PREVIEW_HOLD_TTL_S = 60 * 60;

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

  /**
   * What this turn's yes may answer (chunk H1): whether the person's message is a plain yes, and
   * the assistant's previous message, for the gateway to check a write against. Two minutes: the
   * run's own life.
   */
  async rememberTurn(
    runId: string,
    message: string,
    previousAssistant: string | null | undefined,
  ): Promise<void> {
    try {
      await this.redis.set(
        `agent:turn:${runId}`,
        JSON.stringify({
          yes: isPlainYes(message),
          previous: (previousAssistant ?? '').slice(0, 4000),
        }),
        TURN_TTL_S,
      );
    } catch (error) {
      this.logger.warn(
        `Could not store the turn: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }

  /**
   * ally-be has stopped waiting for this run (chunk H1): its reply is being sent, so the gateway
   * refuses any write the run still makes. Ten minutes, longer than any run.
   */
  async endRun(runId: string): Promise<void> {
    try {
      await this.redis.set(`agent:ended:${runId}`, '1', 600);
    } catch (error) {
      this.logger.warn(
        `Could not mark the run ended: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }

  /** Whether ally-be has stopped waiting for this run. A Redis failure reads as not ended. */
  async ended(runId: string): Promise<boolean> {
    try {
      return Boolean(await this.redis.get(`agent:ended:${runId}`));
    } catch {
      return false;
    }
  }

  /** The assistant's previous message this turn answers, when ally-be recorded it. */
  async previousMessage(runId: string): Promise<string | null> {
    return (await this.turn(runId))?.previous || null;
  }

  private async turn(
    runId: string,
  ): Promise<{ yes: boolean; previous: string } | null> {
    try {
      const raw = await this.redis.get(`agent:turn:${runId}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  /** Store what this run would write, replacing any earlier offer. */
  async offer(
    ctx: { chatbotId: string; conversationId: string; runId: string },
    tool: string,
    key: string,
    list: string,
    questions: OfferQuestions,
    /** BT1: what a Confirm tap replays, and the card it confirms. */
    tap?: Pick<WriteOffer, 'input' | 'card'>,
  ): Promise<WriteOffer> {
    const offer: WriteOffer = {
      id: randomUUID(),
      runId: ctx.runId,
      tool,
      key,
      list,
      questions,
      createdAt: Date.now(),
      ...(tap?.input ? { input: tap.input } : {}),
      ...(tap?.card ? { card: tap.card } : {}),
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
    /** Whether a message names exactly this entry (and for a move, the one it moves). */
    names?: (message: string) => boolean,
  ): Promise<WriteOffer | null> {
    // A plain yes to the assistant's last message, which named exactly this entry, in its own
    // words (the model asked before calling the tool): that is the person's yes to it.
    if (names) {
      const turn = await this.turn(ctx.runId);
      if (turn?.yes && turn.previous && names(turn.previous)) {
        return {
          id: 'previous-message',
          runId: 'previous-turn',
          tool,
          key,
          list: '',
          questions: { en: '', hi: '' },
          createdAt: Date.now(),
        };
      }
    }
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

  /**
   * Try it's test bookings hold their entries for the rest of that test chat (Q4 B4): a slot a
   * test booking took is left out of "which slots are free?" and can't be test-booked again.
   * Nothing is saved; the holds live in Redis for an hour. A Redis failure holds nothing.
   */
  async hold(
    chatbotId: string,
    conversationId: string,
    ids: string[],
  ): Promise<void> {
    if (!ids.length) return;
    try {
      const held = await this.held(chatbotId, conversationId);
      const next = [...new Set([...held, ...ids])].slice(-200);
      await this.redis.set(
        `bot:preview-holds:${chatbotId}:${conversationId}`,
        JSON.stringify(next),
        PREVIEW_HOLD_TTL_S,
      );
    } catch {
      // Test only: a hold that can't be kept just isn't.
    }
  }

  async held(chatbotId: string, conversationId: string): Promise<string[]> {
    try {
      const raw = await this.redis.get(
        `bot:preview-holds:${chatbotId}:${conversationId}`,
      );
      const parsed: unknown = raw ? JSON.parse(String(raw)) : [];
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
}
