import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { LoggerService } from 'src/logger/logger.service';
import { ChatbotSettingsService } from 'src/chatbot/service/chatbot-settings.service';
import {
  ConversationService,
  type ContactScope,
} from 'src/chatbot/service/conversation.service';
import type { ChatbotConversation } from 'src/chatbot/entity/chatbot-conversation.entity';
import { ConversationChannel } from 'src/chatbot/enum/conversation.enum';
import { WaContact } from '../entity/wa-contact.entity';
import { WaConversation } from '../entity/wa-conversation.entity';
import { WaMessage } from '../entity/wa-message.entity';
import type { WhatsAppBotSettings } from '../type/whatsapp-settings.type';
import {
  contactIdsFor,
  hasThread,
  mutableFieldsOf,
  sharedMessageOf,
  whatsappIdentityOf,
} from './wa-shared-store.mapper';

/**
 * How long WhatsApp waits for the inbound copy before reading history from the shared store.
 * Past it, history comes from `wa_messages` as always: a slow copy never delays a reply by more.
 */
export const SHARED_HISTORY_WAIT_MS = 250;

/**
 * WhatsApp's half of the dual-write (Agents v2, chunk 12): copies `wa_*` rows into the shared
 * conversation store while `sharedStoreWrites` is on.
 *
 * `wa_*` stays the source of truth, so every copy is READ BACK from it by id — the stored row,
 * `createdAt` included — rather than rebuilt from what the caller had in memory. A copy is therefore
 * the same however late it runs, and the backfill can repeat any copy that never happened.
 *
 * THE RULE: nothing here may fail or delay a WhatsApp reply. Every method resolves (never rejects);
 * a failure is logged with ids only and counted. Copies run in the background — the one wait is
 * `history()`, used only when history is read from this store, and it is capped at
 * SHARED_HISTORY_WAIT_MS.
 */
@Injectable()
export class WaSharedStoreWriter {
  private readonly logger = LoggerService.getInstance(WaSharedStoreWriter.name);

  /** Failed copies since the process started, logged with each failure. */
  private failures = 0;
  /** The inbound copy still running, by inbound message id, so its reply is copied after it. */
  private readonly inboundCopies = new Map<string, Promise<boolean>>();
  private readonly inFlight = new Set<Promise<boolean>>();

  constructor(
    private readonly conversations: ConversationService,
    private readonly settingsService: ChatbotSettingsService,
    @InjectRepository(WaMessage)
    private readonly messageRepository: Repository<WaMessage>,
    @InjectRepository(WaConversation)
    private readonly conversationRepository: Repository<WaConversation>,
    @InjectRepository(WaContact)
    private readonly contactRepository: Repository<WaContact>,
  ) {}

  /** Whether history is read from the shared store with these settings. */
  readsShared(settings: WhatsAppBotSettings): boolean {
    return (
      settings.sharedStoreWrites === true &&
      settings.readHistoryFrom === 'shared'
    );
  }

  /**
   * Copy an inbound message once it belongs to a thread, with the thread and the contact. Runs in
   * the background; the promise says whether the copy is complete (false when off or failed).
   */
  mirrorInbound(
    settings: WhatsAppBotSettings,
    inboundId: string,
  ): Promise<boolean> {
    if (!settings.sharedStoreWrites) return Promise.resolve(false);
    const copy = this.track('inbound copy', inboundId, () =>
      this.copyMessages([inboundId]),
    );
    this.inboundCopies.set(inboundId, copy);
    void copy.finally(() => this.inboundCopies.delete(inboundId));
    return copy;
  }

  /**
   * The thread's history from the shared store, or null to read it from `wa_messages`: when the
   * inbound copy is not complete within SHARED_HISTORY_WAIT_MS, or the read fails.
   */
  async history(
    conversationId: string,
    inboundCopy: Promise<boolean>,
  ): Promise<{ role: string; content: string }[] | null> {
    let timer: NodeJS.Timeout | undefined;
    const copied = await Promise.race([
      inboundCopy,
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), SHARED_HISTORY_WAIT_MS);
      }),
    ]);
    clearTimeout(timer);
    if (!copied) {
      this.logger.warn(
        `Shared history for conversation ${conversationId} not ready; read from wa_messages`,
      );
      return null;
    }
    try {
      return await this.conversations.recentHistory(conversationId);
    } catch (error) {
      this.recordFailure('history read', conversationId, error);
      return null;
    }
  }

  /**
   * Bring messages up to date after they changed — sent, failed, discarded — in the background.
   * `after` is the inbound message whose copy must land first, so a reply never arrives before its
   * thread does.
   */
  sync(ids: string[], after?: string): Promise<boolean> {
    return this.track('sync', ids.join(','), async () => {
      const settings = await this.settingsService.get();
      if (!settings.sharedStoreWrites) return false;
      const pending = after ? this.inboundCopies.get(after) : undefined;
      if (pending) await pending;
      return this.copyMessages(ids);
    });
  }

  /** Resolves when every copy started so far has finished. For tests and orderly shutdown. */
  async settled(): Promise<void> {
    while (this.inFlight.size) {
      await Promise.all([...this.inFlight]);
    }
  }

  // ──────────────────────────────────────────────────────────────── copying

  private async copyMessages(ids: string[]): Promise<boolean> {
    const rows = await this.messageRepository.find({ where: { id: In(ids) } });
    const threads = new Map<string, ChatbotConversation | null>();
    for (const row of rows) {
      // Discarded before its contact was known: there is no thread to put it in.
      if (!hasThread(row)) continue;
      if (!threads.has(row.conversationId)) {
        threads.set(
          row.conversationId,
          await this.copyThread(row.conversationId),
        );
      }
      const thread = threads.get(row.conversationId);
      if (!thread) continue;
      await this.conversations.appendMessage(thread.id, sharedMessageOf(row));
      await this.conversations.updateMessage(row.id, mutableFieldsOf(row));
    }
    return true;
  }

  /**
   * The shared store's contact for this WhatsApp contact, resolved now (chunk 6): the run token
   * needs it before the reply, and the background copy hasn't run yet. The same resolution the
   * copy makes (`copyThread`), so both land on one row. Null while `sharedStoreWrites` is off, or
   * if it fails: that run isn't offered the tools of lists with a person field.
   */
  async contactIdFor(
    settings: WhatsAppBotSettings,
    contact: WaContact,
    chatbotId: string,
  ): Promise<string | null> {
    if (!settings.sharedStoreWrites) return null;
    try {
      const identity = whatsappIdentityOf(contact);
      const shared = await this.conversations.resolveContact(
        { chatbotId },
        ConversationChannel.WHATSAPP,
        identity.externalId,
        {
          verified: identity.verified,
          verifiedAt: identity.verifiedAt,
          preferredIds: contactIdsFor(contact.id, chatbotId),
        },
      );
      return shared.id;
    } catch (error) {
      this.recordFailure('contact', contact.id, error);
      return null;
    }
  }

  /** The thread and its contact, copied with the `wa_*` ids. Null for a thread with no bot. */
  private async copyThread(
    waConversationId: string,
  ): Promise<ChatbotConversation | null> {
    const thread = await this.conversationRepository.findOne({
      where: { id: waConversationId },
    });
    if (!thread?.chatbotId) return null;
    const contact = await this.contactRepository.findOne({
      where: { id: thread.contactId },
    });
    if (!contact) return null;

    const scope: ContactScope = { chatbotId: thread.chatbotId };
    const identity = whatsappIdentityOf(contact);
    const shared = await this.conversations.resolveContact(
      scope,
      ConversationChannel.WHATSAPP,
      identity.externalId,
      {
        verified: identity.verified,
        verifiedAt: identity.verifiedAt,
        preferredIds: contactIdsFor(contact.id, thread.chatbotId),
      },
    );
    return this.conversations.openConversation(
      thread.chatbotId,
      shared.id,
      ConversationChannel.WHATSAPP,
      {
        id: thread.id,
        startedAt: thread.startedAt,
        now: thread.lastMessageAt,
        connectorId: thread.connectorId ?? null,
      },
    );
  }

  // ──────────────────────────────────────────────────────────────── plumbing

  /** Run a copy so that it never rejects, and remember it until it finishes. */
  private track(
    what: string,
    ref: string,
    work: () => Promise<boolean>,
  ): Promise<boolean> {
    const run = (async () => {
      try {
        return await work();
      } catch (error) {
        this.recordFailure(what, ref, error);
        return false;
      }
    })();
    this.inFlight.add(run);
    void run.finally(() => this.inFlight.delete(run));
    return run;
  }

  /** Ids and the error's message only: a failed insert's detail can carry a phone number. */
  private recordFailure(what: string, ref: string, error: unknown): void {
    this.failures += 1;
    this.logger.warn(
      `Shared store ${what} failed for ${ref} (${this.failures} failure(s) since start); ` +
        `wa_* is unaffected and the backfill will repair it: ` +
        `${error instanceof Error ? error.message : 'unknown error'}`,
    );
  }
}
