import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  ConnectorRegistry,
  ConnectorSummary,
} from '../../chatbot/connector/connector-registry';
import { WhatsAppBusinessNumberService } from './whatsapp-business-number.service';

/**
 * Registers WhatsApp as a connector type, so the chatbot side can list, summarise and disconnect
 * WhatsApp connectors without knowing anything about Meta. Connecting a number stays WhatsApp's own
 * flow (`POST v1/whatsapp/numbers/manual`), which checks the credentials with Meta first.
 */
@Injectable()
export class WhatsAppConnectorType implements OnModuleInit {
  constructor(
    private readonly registry: ConnectorRegistry,
    private readonly numbers: WhatsAppBusinessNumberService,
  ) {}

  onModuleInit(): void {
    this.registry.register({
      type: 'whatsapp',
      label: 'WhatsApp',
      description:
        'A WhatsApp Business number from a Meta app. People message the number and the bot replies.',
      // Meta's limit is 4096; replies are composed well inside it by the bot's own maxReplyChars.
      capabilities: { maxReplyChars: 4096, streaming: false },
      summarise: (ids) => this.summarise(ids),
      disconnect: (id) => this.numbers.wipeForConnector(id),
    });
  }

  private async summarise(
    connectorIds: string[],
  ): Promise<Map<string, ConnectorSummary>> {
    const rows = await this.numbers.findByConnectorIds(connectorIds);
    const lastInbound = await this.numbers.lastInboundAt(rows.map((r) => r.id));
    return new Map(
      rows.map((row) => [
        row.connectorId!,
        {
          address: row.displayPhoneNumber ?? row.phoneNumberId,
          status: row.status,
          lastError: row.lastError ?? null,
          lastInboundAt: lastInbound.get(row.id) ?? null,
          details: {
            numberId: row.id,
            verifiedName: row.verifiedName ?? null,
            source: row.source,
          },
        },
      ]),
    );
  }
}
