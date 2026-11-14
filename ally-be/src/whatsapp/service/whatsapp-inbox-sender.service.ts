import { Inject, Injectable, Optional } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  WHATSAPP_SEND_EVENT,
  type WhatsAppSendRequest,
  type WhatsAppSendResult,
} from 'src/chatbot/handover/handover.service';
import { LoggerService } from '../../logger/logger.service';
import { WaContact } from '../entity/wa-contact.entity';
import { WaConversation } from '../entity/wa-conversation.entity';
import { WaMessage } from '../entity/wa-message.entity';
import { WaMessageDirection, WaMessageStatus } from '../enum/whatsapp.enum';
import {
  WHATSAPP_PROVIDER,
  type WhatsAppProvider,
} from '../type/whatsapp-provider.interface';
import { WaSharedStoreWriter } from '../shared-store/wa-shared-store.writer';
import { WhatsAppBusinessNumberService } from './whatsapp-business-number.service';

/**
 * Sends the inbox's messages on WhatsApp (chunk 11a): a team member's reply, or the assistant's
 * auto hand-back line. Through the bot's own number; `wa_messages` stays the source of truth (the
 * row is saved before the send, as for the assistant's replies), and it's mirrored to the shared
 * store. The 24-hour window is checked by the caller first.
 */
@Injectable()
export class WhatsAppInboxSender {
  private readonly logger = LoggerService.getInstance(WhatsAppInboxSender.name);

  constructor(
    @InjectRepository(WaConversation)
    private readonly conversations: Repository<WaConversation>,
    @InjectRepository(WaContact)
    private readonly contacts: Repository<WaContact>,
    @InjectRepository(WaMessage)
    private readonly messages: Repository<WaMessage>,
    @Inject(WHATSAPP_PROVIDER) private readonly provider: WhatsAppProvider,
    private readonly numbers: WhatsAppBusinessNumberService,
    @Optional() private readonly sharedStore?: WaSharedStoreWriter,
  ) {}

  @OnEvent(WHATSAPP_SEND_EVENT)
  async send(request: WhatsAppSendRequest): Promise<WhatsAppSendResult> {
    const conversation = await this.conversations.findOne({
      where: { id: request.conversationId },
    });
    const contact = conversation
      ? await this.contacts.findOne({ where: { id: conversation.contactId } })
      : null;
    if (!conversation || !contact) return { messageId: '', sent: false };
    const row = await this.messages.save(
      this.messages.create({
        conversationId: conversation.id,
        contactId: contact.id,
        direction: WaMessageDirection.OUTBOUND,
        body: request.text,
        handledBy: request.handledBy,
        sentByUserId: request.sentByUserId,
        status: WaMessageStatus.QUEUED,
      }),
    );
    try {
      const creds = await this.numbers.credentialsFor(contact.businessNumberId);
      if (!creds)
        throw new Error("This assistant's WhatsApp number is disconnected");
      const { providerMessageId } = await this.provider.sendText(
        contact.phoneE164,
        request.text,
        creds,
      );
      await this.messages.update(
        { id: row.id },
        { providerMessageId, status: WaMessageStatus.SENT },
      );
      await this.conversations.update(
        { id: conversation.id },
        { lastMessageAt: new Date() },
      );
      return { messageId: row.id, sent: true };
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown error';
      // The reason only: never the message text or the number.
      this.logger.warn(`[INBOX] WhatsApp send failed: ${reason}`);
      await this.messages.update(
        { id: row.id },
        { status: WaMessageStatus.FAILED, errorMessage: reason },
      );
      return { messageId: row.id, sent: false };
    } finally {
      void this.sharedStore?.sync([row.id]);
    }
  }
}
