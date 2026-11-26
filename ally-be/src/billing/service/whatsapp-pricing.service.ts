import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { UsageChannel, UsageKind } from '../enum/billing.enum';
import { BillingCatalogueService } from './billing-catalogue.service';
import { UsageEventService } from './usage-event.service';

/** One billable message from a Meta status callback. */
export interface WhatsAppBillable {
  messageId: string;
  recipient: string;
  category: string;
  pricingModel: string | null;
  at: Date;
}

/**
 * Meta's status callbacks carry `pricing` on each message it charges for (CR1 Part A). Since July
 * 2025 Meta bills per delivered message, by category (marketing, utility, authentication, service)
 * and the recipient's country — not per conversation, as the brief assumed. Only `billable: true`
 * is recorded; service replies within Meta's free tier arrive with `billable: false`.
 */
export function parseWhatsAppBillables(body: unknown): WhatsAppBillable[] {
  const payload = body as {
    entry?: {
      changes?: {
        value?: {
          statuses?: {
            id?: string;
            status?: string;
            timestamp?: string;
            recipient_id?: string;
            recipient_user_id?: string;
            pricing?: {
              billable?: boolean;
              category?: string;
              pricing_model?: string;
            };
          }[];
        };
      }[];
    }[];
  };
  const out: WhatsAppBillable[] = [];
  for (const entry of payload?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      for (const status of change?.value?.statuses ?? []) {
        if (!status?.id || !status.pricing?.billable) continue;
        if (status.status === 'failed') continue;
        out.push({
          messageId: String(status.id).slice(0, 120),
          recipient: String(
            status.recipient_id ?? status.recipient_user_id ?? '',
          ),
          category: String(status.pricing.category ?? 'service').toLowerCase(),
          pricingModel: status.pricing.pricing_model ?? null,
          at: status.timestamp
            ? new Date(Number(status.timestamp) * 1000)
            : new Date(),
        });
      }
    }
  }
  return out;
}

/** Dialling code → ISO country, for the markets Ally serves first; anything else is recorded unpriced. */
const DIAL_CODES: Array<[string, string]> = [
  ['971', 'AE'],
  ['966', 'SA'],
  ['880', 'BD'],
  ['977', 'NP'],
  ['94', 'LK'],
  ['92', 'PK'],
  ['91', 'IN'],
  ['65', 'SG'],
  ['61', 'AU'],
  ['44', 'GB'],
  ['1', 'US'],
];

export function countryOf(phone: string): string | null {
  // WA-A §4: a business-scoped user ID starts with the person's country (`IN.1349…`).
  const scoped = /^([A-Z]{2})\.[A-Za-z0-9]+$/.exec(String(phone ?? ''));
  if (scoped) return scoped[1];
  const digits = String(phone ?? '').replace(/\D/g, '');
  for (const [code, country] of DIAL_CODES) {
    if (digits.startsWith(code)) return country;
  }
  return null;
}

@Injectable()
export class WhatsAppPricingService {
  private readonly logger = LoggerService.getInstance(
    WhatsAppPricingService.name,
  );

  constructor(
    private readonly dataSource: DataSource,
    private readonly catalogue: BillingCatalogueService,
    private readonly usage: UsageEventService,
  ) {}

  /** Record the billable messages in one webhook body. Never throws: the webhook has answered. */
  async recordStatuses(body: unknown): Promise<number> {
    let recorded = 0;
    for (const billable of parseWhatsAppBillables(body)) {
      try {
        const [owner] = await this.dataSource.query(
          `SELECT c.chatbot_id AS "chatbotId", m.conversation_id AS "conversationId"
             FROM chatbot_messages m JOIN chatbot_conversations c ON c.id = m.conversation_id
            WHERE m.provider_message_id = $1 AND m.channel = 'whatsapp' LIMIT 1`,
          [billable.messageId],
        );
        // A message no assistant sent (a v1 reply, a template from elsewhere) isn't an assistant's cost.
        if (!owner?.chatbotId) continue;
        const country = countryOf(billable.recipient);
        const rate = country
          ? await this.catalogue.whatsAppRateAt(
              country,
              billable.category,
              billable.at,
            )
          : null;
        const event = await this.usage.record({
          runId: billable.messageId,
          kind: UsageKind.WHATSAPP,
          channel: UsageChannel.WHATSAPP,
          chatbotId: owner.chatbotId,
          conversationId: owner.conversationId,
          provider: 'meta',
          model: `whatsapp:${billable.category}`,
          units: 1,
          unit: 'call',
          fixedCostMicros: rate ? Number(rate.priceMicros) : null,
          priceId: rate?.id ?? null,
          occurredAt: billable.at,
          detail: {
            category: billable.category,
            country,
            pricingModel: billable.pricingModel,
          },
        });
        if (event) recorded += 1;
      } catch (error) {
        this.logger.warn(
          `WhatsApp fee for message ${billable.messageId} not recorded: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
      }
    }
    return recorded;
  }
}
