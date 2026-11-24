import { Injectable } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { AppConfigService } from '../../config/config.service';
import { LoggerService } from '../../logger/logger.service';
import { RedisService } from '../../redis/service/redis.service';
import type { WriteOffer } from '../agent-tools/list-consent';

/** How long a tap's button works (BT1): 30 minutes from the reply that carried it. */
export const ACTION_TTL_S = 30 * 60;

/** What a tap does (BT1 §2). */
export type ActionKind =
  | 'choose'
  | 'confirm'
  | 'change'
  | 'cancel'
  | 'move'
  | 'keep'
  | 'ask';

/** What a token stands for: the action, who may tap it, and where. */
export interface ActionClaims {
  kind: ActionKind;
  chatbotId: string;
  conversationId: string;
  /** The person the reply went to; null for Try it's test chat (no contact). */
  contactId: string | null;
  /** The words the tap stands for: shown as the person's message and, for most taps, sent on. */
  text: string;
  /** confirm: the offer exactly as it was shown. */
  offer?: WriteOffer;
  /** cancel and move: the entry. */
  entryId?: string;
}

export type RedeemFailure = 'invalid' | 'expired' | 'not_yours';

/**
 * Signed, single-use action tokens (BT1 §2). A token is a short random id and its HMAC (short
 * enough for a WhatsApp list row's or reply button's id), and the claims wait in Redis for 30
 * minutes. A token works only in its own conversation, for its own person. The first use is
 * recorded: a second tap on the same Confirm replays the first one's result (the gateway's step
 * replay), and any other tap reused does nothing.
 *
 * A Redis failure fails closed: no token can be issued or redeemed, so nothing is written by tap.
 */
@Injectable()
export class ActionTokenService {
  private readonly logger = LoggerService.getInstance(ActionTokenService.name);

  constructor(
    private readonly config: AppConfigService,
    private readonly redis: RedisService,
  ) {}

  /** A token for these claims, or null when it can't be stored (no button is then shown). */
  async issue(claims: ActionClaims): Promise<string | null> {
    const id = randomBytes(12).toString('base64url');
    try {
      await this.redis.set(this.key(id), JSON.stringify(claims), ACTION_TTL_S);
    } catch (error) {
      this.logger.warn(
        `Could not store an action token: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      return null;
    }
    return `${id}.${this.sign(id)}`;
  }

  /**
   * The claims behind a token, when it is genuine, unexpired and tapped in its own conversation by
   * its own person; `firstUse` is false for every tap after the first.
   */
  async redeem(
    token: string,
    where: {
      chatbotId: string;
      conversationId: string;
      contactId: string | null;
    },
  ): Promise<
    | { ok: true; claims: ActionClaims; firstUse: boolean }
    | { ok: false; reason: RedeemFailure }
  > {
    const [id, sig] = String(token ?? '').split('.');
    if (!id || !sig || !this.verify(id, sig)) {
      return { ok: false, reason: 'invalid' };
    }
    let claims: ActionClaims | null = null;
    try {
      const raw = await this.redis.get(this.key(id));
      claims = raw ? (JSON.parse(raw) as ActionClaims) : null;
    } catch (error) {
      this.logger.warn(
        `Could not read an action token: ${error instanceof Error ? error.message : 'unknown'}`,
      );
      return { ok: false, reason: 'expired' };
    }
    if (!claims) return { ok: false, reason: 'expired' };
    if (
      claims.chatbotId !== where.chatbotId ||
      claims.conversationId !== where.conversationId ||
      (claims.contactId ?? null) !== (where.contactId ?? null)
    ) {
      return { ok: false, reason: 'not_yours' };
    }
    let firstUse = false;
    try {
      firstUse = await this.redis.acquireLock(this.usedKey(id), ACTION_TTL_S);
    } catch {
      firstUse = false;
    }
    return { ok: true, claims, firstUse };
  }

  /**
   * WhatsApp's numbered text (BT1 §3): which token each number stands for in this conversation,
   * until the next numbered list or 30 minutes. A typed number then counts as that tap.
   */
  async rememberNumbered(
    conversationId: string,
    tokens: string[],
  ): Promise<void> {
    try {
      await this.redis.set(
        this.numberedKey(conversationId),
        JSON.stringify(tokens),
        ACTION_TTL_S,
      );
    } catch (error) {
      this.logger.warn(
        `Could not store a numbered list: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }

  /** The token a typed number stands for, or null when there is no such list or number. */
  async numbered(conversationId: string, n: number): Promise<string | null> {
    try {
      const raw = await this.redis.get(this.numberedKey(conversationId));
      const tokens = raw ? (JSON.parse(raw) as string[]) : [];
      return tokens[n - 1] ?? null;
    } catch {
      return null;
    }
  }

  /** A typed message that isn't a number ends the numbered list: "2" later means 2. */
  async forgetNumbered(conversationId: string): Promise<void> {
    try {
      await this.redis.del(this.numberedKey(conversationId));
    } catch {
      // Nothing to do: it expires in 30 minutes.
    }
  }

  private numberedKey(conversationId: string): string {
    return `bot:numbered:${conversationId}`;
  }

  private key(id: string): string {
    return `bot:action:${id}`;
  }

  private usedKey(id: string): string {
    return `bot:action-used:${id}`;
  }

  private sign(id: string): string {
    return createHmac('sha256', this.secret())
      .update(id)
      .digest('base64url')
      .slice(0, 22);
  }

  private verify(id: string, sig: string): boolean {
    const expected = Buffer.from(this.sign(id));
    const given = Buffer.from(sig);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  private secret(): string {
    const own = this.config.agentGatewaySecret;
    const base = own || this.config.jwt.accessToken.secret;
    if (!base) throw new Error('No secret to sign action tokens with');
    return createHmac('sha256', base).update('bot-action-v1').digest('hex');
  }
}
