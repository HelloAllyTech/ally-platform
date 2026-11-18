import { Injectable } from '@nestjs/common';
import { CryptoService } from 'src/common/service/crypto.service';
import { AppConfigService } from 'src/config/config.service';
import { LoggerService } from 'src/logger/logger.service';

/** Marks a value this class wrote, so a future key rotation can tell versions apart. */
const WA_CREDENTIAL_CIPHER_PREFIX = 'waenc:v1:';

/**
 * Organisations' WhatsApp access tokens and app secrets at rest (`wa_business_numbers`).
 *
 * A token sends messages as that organisation to its workers, and an app secret is what makes a
 * forged webhook indistinguishable from Meta — neither may ever be stored or logged in plaintext.
 *
 * Unlike the helpline cipher this one has no plaintext passthrough and DOES throw on a bad value:
 * there are no legacy rows, and a credential that will not decrypt is unusable, so the caller must
 * mark the number broken rather than send with garbage.
 */
@Injectable()
export class WhatsAppCredentialCipherService {
  private readonly logger = LoggerService.getInstance(
    WhatsAppCredentialCipherService.name,
  );

  constructor(
    private readonly crypto: CryptoService,
    private readonly config: AppConfigService,
  ) {}

  get configured(): boolean {
    return Boolean(this.key);
  }

  private get key(): string | undefined {
    return this.config.whatsapp.credentialsEncryptionKey;
  }

  async encrypt(plain: string): Promise<string> {
    if (!this.key) {
      this.logger.error(
        'WHATSAPP_CREDENTIALS_ENCRYPTION_KEY is not set: WhatsApp credentials cannot be stored',
      );
      throw new Error('WhatsApp credential encryption is not configured');
    }
    return (
      WA_CREDENTIAL_CIPHER_PREFIX + (await this.crypto.encrypt(plain, this.key))
    );
  }

  /** `field` names what failed in the log — never the value. */
  async decrypt(stored: string, field: string): Promise<string> {
    if (!stored.startsWith(WA_CREDENTIAL_CIPHER_PREFIX) || !this.key) {
      this.logger.error(`WhatsApp credential unreadable (field=${field})`);
      throw new Error(`The stored ${field} cannot be read`);
    }
    try {
      return await this.crypto.decrypt(
        stored.slice(WA_CREDENTIAL_CIPHER_PREFIX.length),
        this.key,
      );
    } catch {
      this.logger.error(`WhatsApp credential decrypt failed (field=${field})`);
      throw new Error(`The stored ${field} cannot be read`);
    }
  }
}
