import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { MANUAL_CHAT_LIMITS } from '../constants/manual-agent.constants';
import {
  ManualChatDraft,
  ManualChatMessage,
  ManualConversation,
} from '../entity/manual-conversation.entity';

export type ConversationRow = { id: string; title: string; updatedAt: string };
export type ConversationView = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ManualChatMessage[];
  drafts: ManualChatDraft[];
};

const iso = (d: Date | string | null | undefined): string =>
  d ? new Date(d).toISOString() : new Date(0).toISOString();

/** "New chat" until the first message names it: its first 60 characters on one line. */
export function titleFrom(message: string): string {
  const line = String(message ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!line) return 'New chat';
  return line.length > MANUAL_CHAT_LIMITS.TITLE_CHARS
    ? `${line.slice(0, MANUAL_CHAT_LIMITS.TITLE_CHARS - 1).trimEnd()}…`
    : line;
}

/**
 * A user's chats with the manual. Only the owner can read, write or delete one: every lookup is by
 * (id, userId), and another user's conversation is a 404, not a 403, so ids are not probeable.
 *
 * Messages and drafts are appended with jsonb concatenation rather than read-modify-write: the chat
 * lock already serialises one stream per conversation, but a tray action (save / dismiss) can land
 * while a turn is streaming.
 */
@Injectable()
export class ManualConversationService {
  constructor(
    @InjectRepository(ManualConversation)
    private readonly repo: Repository<ManualConversation>,
  ) {}

  async list(userId: number): Promise<ConversationRow[]> {
    const rows = await this.repo.find({
      where: { userId, deletedAt: IsNull() },
      select: ['id', 'title', 'updatedAt'],
      order: { updatedAt: 'DESC' },
      take: 100,
    });
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      updatedAt: iso(r.updatedAt),
    }));
  }

  /** The caller's own conversation, or 404. */
  async getOwned(userId: number, id: string): Promise<ManualConversation> {
    const row = await this.repo.findOne({
      where: { id, userId, deletedAt: IsNull() },
    });
    if (!row) throw new NotFoundException('No such conversation.');
    return row;
  }

  async view(userId: number, id: string): Promise<ConversationView> {
    const row = await this.getOwned(userId, id);
    return {
      id: row.id,
      title: row.title,
      createdAt: iso(row.createdAt),
      updatedAt: iso(row.updatedAt),
      messages: row.messages ?? [],
      drafts: (row.drafts ?? []).filter((d) => !d.discarded),
    };
  }

  async create(
    userId: number,
    firstMessage: string,
  ): Promise<ManualConversation> {
    return this.repo.save(
      this.repo.create({
        userId,
        title: titleFrom(firstMessage),
        messages: [],
        drafts: [],
      }),
    );
  }

  async remove(userId: number, id: string): Promise<void> {
    await this.getOwned(userId, id);
    await this.repo.update({ id, userId }, { deletedAt: new Date() });
  }

  async appendMessages(
    id: string,
    messages: ManualChatMessage[],
  ): Promise<void> {
    if (!messages.length) return;
    await this.repo.query(
      `UPDATE manual_conversations
          SET messages = messages || $1::jsonb, updated_at = now()
        WHERE id = $2`,
      [JSON.stringify(messages), id],
    );
  }

  async appendDrafts(id: string, drafts: ManualChatDraft[]): Promise<void> {
    if (!drafts.length) return;
    await this.repo.query(
      `UPDATE manual_conversations
          SET drafts = drafts || $1::jsonb, updated_at = now()
        WHERE id = $2`,
      [JSON.stringify(drafts), id],
    );
  }

  /** The caller's draft card, or 404. */
  async getDraft(
    userId: number,
    conversationId: string,
    draftId: string,
  ): Promise<ManualChatDraft> {
    const row = await this.getOwned(userId, conversationId);
    const draft = (row.drafts ?? []).find((d) => d.id === draftId);
    if (!draft) throw new NotFoundException('No such draft.');
    return draft;
  }

  /** Merge a patch into one draft card (saved code, discarded). */
  async patchDraft(
    userId: number,
    conversationId: string,
    draftId: string,
    patch: Partial<
      Pick<ManualChatDraft, 'savedCode' | 'discarded' | 'title' | 'text'>
    >,
  ): Promise<void> {
    await this.getDraft(userId, conversationId, draftId);
    await this.repo.query(
      `UPDATE manual_conversations
          SET drafts = (
                SELECT COALESCE(jsonb_agg(
                         CASE WHEN d->>'id' = $1 THEN d || $2::jsonb ELSE d END
                         ORDER BY ord), '[]'::jsonb)
                  FROM jsonb_array_elements(drafts) WITH ORDINALITY AS t(d, ord)
              ),
              updated_at = now()
        WHERE id = $3 AND user_id = $4`,
      [draftId, JSON.stringify(patch), conversationId, userId],
    );
  }
}
