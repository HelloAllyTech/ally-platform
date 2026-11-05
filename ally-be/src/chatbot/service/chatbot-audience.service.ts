import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ExecutionManager } from '../../common/execution/execution-manager';
import { isSamePhone, phoneDigits } from '../../whatsapp/util/phone';
import { ChatbotAudience } from '../entity/chatbot-audience.entity';
import { Chatbot } from '../entity/chatbot.entity';
import { ChatbotAccessMode, ChatbotAudienceKind } from '../enum/chatbot.enum';
import type { ChatSender } from '../engine/chatbot-engine.types';

export interface AudienceEntryInput {
  kind: ChatbotAudienceKind;
  value: string;
  label?: string | null;
}

/**
 * A bot's "who can chat" list, and the check every message goes through.
 *
 * The check is deliberately channel-neutral: it compares what the channel could tell about the
 * sender (a user, their organisation, a phone, an email) against the list, so a new channel only
 * has to fill in the sender — it never needs its own access logic.
 */
@Injectable()
export class ChatbotAudienceService {
  constructor(
    @InjectRepository(ChatbotAudience)
    private readonly audienceRepository: Repository<ChatbotAudience>,
  ) {}

  async canChat(
    chatbot: Pick<Chatbot, 'id' | 'accessMode'>,
    sender: ChatSender,
  ): Promise<boolean> {
    switch (chatbot.accessMode) {
      case ChatbotAccessMode.ANYONE:
        return true;
      case ChatbotAccessMode.RECOGNISED:
        return Boolean(sender.userId || sender.tenantId);
      case ChatbotAccessMode.LISTED: {
        const entries = await this.audienceRepository.find({
          where: { chatbotId: chatbot.id },
        });
        return entries.some((entry) =>
          ChatbotAudienceService.matches(entry, sender),
        );
      }
      default:
        return false;
    }
  }

  static matches(
    entry: Pick<ChatbotAudience, 'kind' | 'value'>,
    sender: ChatSender,
  ): boolean {
    switch (entry.kind) {
      case ChatbotAudienceKind.USER:
        return sender.userId != null && String(sender.userId) === entry.value;
      case ChatbotAudienceKind.ORGANISATION:
        return (
          Boolean(sender.tenantId) && String(sender.tenantId) === entry.value
        );
      case ChatbotAudienceKind.PHONE:
        return Boolean(sender.phone) && isSamePhone(sender.phone, entry.value);
      case ChatbotAudienceKind.EMAIL:
        return (
          Boolean(sender.email) &&
          sender.email!.trim().toLowerCase() === entry.value
        );
      default:
        return false;
    }
  }

  list(chatbotId: string): Promise<ChatbotAudience[]> {
    return this.audienceRepository.find({
      where: { chatbotId },
      order: { kind: 'ASC', createdAt: 'ASC' },
    });
  }

  /**
   * Add entries; ones already on the list are kept as they are. Returns how many were new, so a
   * pasted list of 200 numbers reports what actually changed.
   */
  async add(
    chatbotId: string,
    entries: AudienceEntryInput[],
  ): Promise<{ added: number; skipped: number }> {
    const userId = Number(ExecutionManager.getUserId() ?? 0);
    const rows = entries.map((entry) => ({
      chatbotId,
      kind: entry.kind,
      value: ChatbotAudienceService.normaliseValue(entry.kind, entry.value),
      label: entry.label?.trim() || null,
      createdBy: userId,
    }));
    const result = await this.audienceRepository
      .createQueryBuilder()
      .insert()
      .into(ChatbotAudience)
      .values(rows)
      .orIgnore()
      .returning('id')
      .execute();
    const added = (result.raw as unknown[])?.length ?? 0;
    return { added, skipped: rows.length - added };
  }

  async remove(chatbotId: string, entryId: string): Promise<void> {
    await this.audienceRepository.delete({ id: entryId, chatbotId });
  }

  static normaliseValue(kind: ChatbotAudienceKind, raw: string): string {
    const value = (raw ?? '').trim();
    if (!value) throw new BadRequestException('An entry needs a value.');
    switch (kind) {
      case ChatbotAudienceKind.PHONE: {
        const digits = phoneDigits(value);
        if (digits.length < 7) {
          throw new BadRequestException(`"${value}" is not a phone number.`);
        }
        return `+${digits}`;
      }
      case ChatbotAudienceKind.EMAIL:
        if (!/^[^\s@]+@[^\s@]+$/.test(value)) {
          throw new BadRequestException(`"${value}" is not an email address.`);
        }
        return value.toLowerCase();
      case ChatbotAudienceKind.USER:
        if (!/^\d+$/.test(value)) {
          throw new BadRequestException('A user entry needs a user id.');
        }
        return value;
      case ChatbotAudienceKind.ORGANISATION:
        return value;
      default:
        throw new BadRequestException(`Unknown entry kind "${kind}".`);
    }
  }
}
