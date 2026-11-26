import { Inject, Injectable, Optional } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  WHATSAPP_SEND_EVENT,
  type TeamMedia,
  type WhatsAppSendRequest,
  type WhatsAppSendResult,
} from 'src/chatbot/handover/handover.service';
import { S3Service } from '../../aws/service/s3.service';
import { AppConfigService } from '../../config/config.service';
import {
  TEAM_BUTTON_PREFIX,
  WA_MEDIA_SIGNED_SECONDS,
} from '../media/wa-attachment';
import { LoggerService } from '../../logger/logger.service';
import { WaContact } from '../entity/wa-contact.entity';
import { WaConversation } from '../entity/wa-conversation.entity';
import { WaMessage } from '../entity/wa-message.entity';
import { WaMessageDirection, WaMessageStatus } from '../enum/whatsapp.enum';
import {
  WHATSAPP_PROVIDER,
  type WaNumberCredentials,
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
    // WA-A §3: the team's files, sent by a short-lived signed link Meta fetches.
    @Optional() private readonly s3?: S3Service,
    @Optional() private readonly appConfig?: AppConfigService,
  ) {}

  /**
   * WA-A §3: a file (caption = the text), or reply buttons (BT1's interactive send, ids prefixed so a
   * tap reads as its title), or plain text. Buttons that can't go fall back to the text with the
   * choices listed; a file that can't go fails the send, so the team sees it and its reason.
   */
  private async deliver(
    to: string,
    request: WhatsAppSendRequest,
    creds: WaNumberCredentials,
  ): Promise<{ providerMessageId: string }> {
    if (request.media) {
      const bucket = this.appConfig?.s3.audioBucket;
      if (!this.provider.sendMedia || !this.s3 || !bucket) {
        throw new Error('Files cannot be sent from this environment');
      }
      const link = await this.s3.generatePresignedUrl({
        bucket,
        key: request.media.key,
        operation: 'get',
        expiresIn: WA_MEDIA_SIGNED_SECONDS,
      });
      return this.provider.sendMedia(
        to,
        {
          kind: request.media.kind,
          link,
          mimeType: request.media.mimeType,
          sizeBytes: request.media.sizeBytes,
          caption: request.text.slice(0, 1024),
          ...(request.media.filename
            ? { filename: request.media.filename }
            : {}),
        },
        creds,
      );
    }
    const buttons = (request.buttons ?? []).slice(0, 3);
    if (buttons.length && this.provider.sendInteractive) {
      try {
        return await this.provider.sendInteractive(
          to,
          {
            type: 'button',
            body: request.text.slice(0, 1024),
            buttons: buttons.map((title, i) => ({
              id: `${TEAM_BUTTON_PREFIX}${i}`,
              title: title.slice(0, 20),
            })),
          },
          creds,
        );
      } catch (error) {
        this.logger.warn(
          `[INBOX] Team buttons not sent; sending them as text: ${
            error instanceof Error ? error.message : 'unknown'
          }`,
        );
      }
    }
    const text = buttons.length
      ? `${request.text}\n\n${buttons.map((b) => `• ${b}`).join('\n')}`
      : request.text;
    return this.provider.sendText(to, text, creds);
  }

  /** The file on the team's message in the shared store, for the Inbox. Never throws. */
  private async attachFile(messageId: string, media: TeamMedia): Promise<void> {
    try {
      await this.sharedStore?.sync([messageId]);
      await this.messages.manager?.query(
        `UPDATE chatbot_messages SET attachments = $2::jsonb WHERE id = $1`,
        [
          messageId,
          JSON.stringify([
            {
              kind: media.kind,
              key: media.key,
              mimeType: media.mimeType,
              sizeBytes: media.sizeBytes,
              filename: media.filename ?? null,
            },
          ]),
        ],
      );
    } catch {
      // The send went; the Inbox shows the caption without the file.
    }
  }

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
      const { providerMessageId } = await this.deliver(
        contact.phoneE164,
        request,
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
      if (request.media) await this.attachFile(row.id, request.media);
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
