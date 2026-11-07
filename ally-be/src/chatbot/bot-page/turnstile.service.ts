import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { AppConfigService } from '../../config/config.service';
import { LoggerService } from '../../logger/logger.service';

const SITEVERIFY_URL =
  'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Cloudflare Turnstile, the bot check on public bot pages (chunk 12b). Off while
 * `TURNSTILE_SECRET_KEY` is empty, which is how it runs locally.
 */
@Injectable()
export class TurnstileService {
  private readonly logger = LoggerService.getInstance(TurnstileService.name);

  constructor(private readonly config: AppConfigService) {}

  get enabled(): boolean {
    return Boolean(this.config.botPage.turnstileSecretKey);
  }

  get siteKey(): string | null {
    return this.enabled ? this.config.botPage.turnstileSiteKey || null : null;
  }

  /**
   * Whether Cloudflare accepts the token. Fails CLOSED: a public page is exactly where a bot check
   * that silently passes would be abused, and the visitor can simply try again.
   */
  async verify(
    token: string | undefined,
    ip: string | undefined,
  ): Promise<boolean> {
    if (!this.enabled) return true;
    if (!token) return false;
    try {
      const body = new URLSearchParams({
        secret: this.config.botPage.turnstileSecretKey,
        response: token,
        ...(ip ? { remoteip: ip } : {}),
      });
      const { data } = await axios.post<{ success?: boolean }>(
        SITEVERIFY_URL,
        body.toString(),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 5000,
        },
      );
      return data?.success === true;
    } catch (error) {
      this.logger.warn(
        `Turnstile check failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return false;
    }
  }
}
