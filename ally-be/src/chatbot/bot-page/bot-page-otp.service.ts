import { Injectable } from '@nestjs/common';
import { createHmac, randomInt, timingSafeEqual } from 'crypto';
import { AppConfigService } from '../../config/config.service';
import { LoggerService } from '../../logger/logger.service';
import { EmailService } from '../../notification/service/email.service';
import { RedisService } from '../../redis/service/redis.service';

/** The brief's rules: 10 minutes, at most 5 tries, then the code is gone. */
export const BOT_PAGE_OTP = {
  ttlSeconds: 600,
  maxTries: 5,
  /** Codes sent to one address for one bot per window. */
  maxSends: 5,
  sendWindowSeconds: 900,
} as const;

export type OtpCheck = 'ok' | 'wrong' | 'expired' | 'too_many';
export type OtpSend = 'sent' | 'too_many' | 'failed';

/**
 * One-time codes for organisation-only and invite-only bot pages (chunk 12b).
 *
 * The login OTP's approach (`crypto.randomInt`, a hash in Redis, `incrWithExpiry` counters) under its
 * own keys, with the brief's rules: 6 digits, 10 minutes, 5 tries. Only an HMAC of the code is
 * stored, keyed with a server secret, so a Redis dump can't be turned back into codes; addresses are
 * HMAC'd in keys too, so they never appear in Redis.
 */
@Injectable()
export class BotPageOtpService {
  private readonly logger = LoggerService.getInstance(BotPageOtpService.name);

  constructor(
    private readonly redis: RedisService,
    private readonly email: EmailService,
    private readonly config: AppConfigService,
  ) {}

  async send(
    chatbotId: string,
    email: string,
    page: { title: string; logoUrl?: string | null; accentColour?: string },
  ): Promise<OtpSend> {
    const who = this.addressKey(chatbotId, email);
    const { count } = await this.redis.incrWithExpiry(
      `bp:otp:sent:${who}`,
      BOT_PAGE_OTP.sendWindowSeconds,
    );
    if (count > BOT_PAGE_OTP.maxSends) return 'too_many';

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    await this.redis.set(
      `bp:otp:code:${who}`,
      this.hash(`${who}:${code}`),
      BOT_PAGE_OTP.ttlSeconds,
    );
    await this.redis.del(`bp:otp:tries:${who}`);
    try {
      await this.email.sendBotPageCode({
        to: email,
        code,
        pageTitle: page.title,
        logoUrl: page.logoUrl,
        accentColour: page.accentColour,
        minutes: BOT_PAGE_OTP.ttlSeconds / 60,
      });
      return 'sent';
    } catch {
      if (this.config.isDevelopment) {
        // Local stacks have no working SES (and usually no Slack token for the echo), so in
        // development only the code stays valid and is logged, with the address masked.
        this.logger.warn(
          `Bot page code (development only, email not sent): ${code} for ***${email.slice(email.lastIndexOf('@'))}`,
        );
        return 'sent';
      }
      // SESService has already alerted. The code is useless if it never arrived.
      await this.redis.del(`bp:otp:code:${who}`);
      this.logger.warn(`Bot page code for chatbot ${chatbotId} was not sent`);
      return 'failed';
    }
  }

  async check(
    chatbotId: string,
    email: string,
    code: string,
  ): Promise<OtpCheck> {
    const who = this.addressKey(chatbotId, email);
    const stored = await this.redis.get(`bp:otp:code:${who}`);
    if (!stored) return 'expired';

    const { count } = await this.redis.incrWithExpiry(
      `bp:otp:tries:${who}`,
      BOT_PAGE_OTP.ttlSeconds,
    );
    if (count > BOT_PAGE_OTP.maxTries) {
      await this.burn(who);
      return 'too_many';
    }

    const given = Buffer.from(this.hash(`${who}:${code}`));
    const expected = Buffer.from(stored);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      if (count === BOT_PAGE_OTP.maxTries) {
        await this.burn(who);
        return 'too_many';
      }
      return 'wrong';
    }
    await this.burn(who);
    return 'ok';
  }

  private async burn(who: string): Promise<void> {
    await this.redis.del(`bp:otp:code:${who}`);
    await this.redis.del(`bp:otp:tries:${who}`);
  }

  private addressKey(chatbotId: string, email: string): string {
    return `${chatbotId}:${this.hash(email.trim().toLowerCase()).slice(0, 32)}`;
  }

  private hash(value: string): string {
    return createHmac('sha256', this.pepper()).update(value).digest('hex');
  }

  private pepper(): string {
    const base =
      this.config.botPage.visitorSecret || this.config.jwt.accessToken.secret;
    if (!base) throw new Error('Bot page codes are not configured');
    return createHmac('sha256', base).update('bot-page-otp-v1').digest('hex');
  }
}
