import { v5 as uuidv5 } from 'uuid';
import type { AppendMessageInput } from 'src/chatbot/service/conversation.service';
import {
  ConversationChannel,
  ConversationMessageRole,
} from 'src/chatbot/enum/conversation.enum';
import type { WaContact } from '../entity/wa-contact.entity';
import type { WaMessage } from '../entity/wa-message.entity';
import { WaHandledBy, WaMessageDirection } from '../enum/whatsapp.enum';

/**
 * How WhatsApp's rows become shared-store rows (Agents v2, chunk 12). The dual-write, the backfill
 * and the consistency check all go through these functions, so the two stores cannot drift apart
 * through two different copies of the mapping.
 */

/** The thread id an inbound row carries until its contact is known. Such rows are never copied. */
export const PLACEHOLDER_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Namespace for the contact ids that cannot reuse a `wa_contacts.id`. Must never change: the
 * backfill and the dual-write derive the same id from it independently.
 */
const SHARED_CONTACT_NAMESPACE = 'ede5c359-c7b8-4dc9-bd46-222dc01adba4';

/**
 * The ids a WhatsApp contact may take in the shared store for one bot, in order of preference.
 *
 * A shared contact is per bot while a WhatsApp contact is per number, and a number can move between
 * bots. The first bot copied keeps the `wa_contacts.id`, so links by contact id stay valid in the
 * usual case of one bot per number; each later bot gets an id derived from the pair.
 */
export function contactIdsFor(
  waContactId: string,
  chatbotId: string,
): string[] {
  return [
    waContactId,
    uuidv5(`${waContactId}:${chatbotId}`, SHARED_CONTACT_NAMESPACE),
  ];
}

/** The WhatsApp identity of a contact: the number, vouched for by Meta's delivery. */
export function whatsappIdentityOf(
  contact: Pick<WaContact, 'phoneE164' | 'firstSeenAt'>,
): { externalId: string; verified: boolean; verifiedAt: Date } {
  return {
    externalId: contact.phoneE164,
    verified: true,
    verifiedAt: contact.firstSeenAt,
  };
}

/** True when a `wa_messages` row belongs to a thread (it was attached once the contact was known). */
export function hasThread(row: Pick<WaMessage, 'conversationId'>): boolean {
  return !!row.conversationId && row.conversationId !== PLACEHOLDER_ID;
}

/** A `wa_messages` row as a shared message, keeping its id and `createdAt`. */
export function sharedMessageOf(row: WaMessage): AppendMessageInput {
  return {
    id: row.id,
    createdAt: row.createdAt,
    channel: ConversationChannel.WHATSAPP,
    direction: row.direction,
    role:
      row.direction === WaMessageDirection.INBOUND
        ? ConversationMessageRole.USER
        : row.handledBy === WaHandledBy.HUMAN
          ? ConversationMessageRole.AGENT_HUMAN
          : ConversationMessageRole.ASSISTANT,
    sentByUserId: row.sentByUserId ?? null,
    text: row.body,
    handledBy: row.handledBy ?? null,
    citations: row.citations ?? null,
    retrievalMeta: row.retrievalMeta ?? null,
    agentRunId: row.agentRunId ?? null,
    agentRuntime: row.agentRuntime ?? null,
    providerMessageId: row.providerMessageId ?? null,
    status: row.status,
    language: row.language ?? null,
    templateId: row.templateId ?? null,
    latencyMs: row.latencyMs ?? null,
    errorMessage: row.errorMessage ?? null,
    inReplyToId: row.inReplyToId ?? null,
  };
}

/** The fields of a `wa_messages` row that change after it is written: delivery and blanking. */
export function mutableFieldsOf(row: WaMessage) {
  return {
    status: row.status,
    providerMessageId: row.providerMessageId ?? null,
    handledBy: row.handledBy ?? null,
    errorMessage: row.errorMessage ?? null,
    text: row.body,
    citations: row.citations ?? null,
    retrievalMeta: row.retrievalMeta ?? null,
  };
}
