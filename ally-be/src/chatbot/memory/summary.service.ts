import { usageContext } from 'src/billing/context/usage-context';
import { UsageChannel, UsageKind } from 'src/billing/enum/billing.enum';
import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { isHealthPack } from '../../bot-draft/safety-pack/safety-packs';
import { AiService } from '../../ai/service/ai.service';
import { LoggerService } from '../../logger/logger.service';
import { RedisService } from '../../redis/service/redis.service';
import { MAX_HISTORY_MESSAGES } from '../engine/knowledge-request';
import type { Chatbot } from '../entity/chatbot.entity';

/** One summary at a time per chat; the lock outlives a slow call, never a stuck one for long. */
const LOCK_SECONDS = 60;
/** At most this many messages folded in one call (a long backlog is caught up over replies). */
const MAX_FOLD = 40;
/** The text of an erased message (the retention sweep's and erasure's placeholder). */
const ERASED = '[erased]';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Row {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: Date;
}

/**
 * The rolling summary (chunk 8a): once a chat passes 10 messages, the ones leaving the window a
 * run reads are folded into `chatbot_conversations.summary` by ally-ai, after the reply, never
 * while someone waits. `metadata.summaryUpto` is the id of the last message folded in. At most one at a
 * time per chat (a Redis lock); on failure the old summary stays and the next reply tries again.
 *
 * This chat's only: a new conversation starts without it. On a health pack it says what was asked
 * and decided, never clinical details. Retention and erasure blank it.
 */
@Injectable()
export class SummaryService {
  private readonly logger = LoggerService.getInstance(SummaryService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly ai: AiService,
    private readonly redis: RedisService,
  ) {}

  /** After a reply. Never throws. True when a new summary was stored. */
  async afterTurn(
    chatbot: Pick<Chatbot, 'id' | 'safetyPack'>,
    conversationId: string,
  ): Promise<boolean> {
    // CR1: the summary's model call belongs to this assistant and chat (its own run id).
    return usageContext.with(
      {
        runId: undefined,
        chatbotId: chatbot.id,
        conversationId,
        channel: usageContext.current()?.channel ?? UsageChannel.OTHER,
        runKind: UsageKind.CUSTOMER_REPLY,
      },
      () => this.afterTurnInContext(chatbot, conversationId),
    );
  }

  private async afterTurnInContext(
    chatbot: Pick<Chatbot, 'id' | 'safetyPack'>,
    conversationId: string,
  ): Promise<boolean> {
    if (!UUID.test(conversationId)) return false;
    const lock = `summary:${conversationId}`;
    try {
      const fold = await this.toFold(chatbot.id, conversationId);
      if (!fold) return false;
      if (!(await this.redis.acquireLock(lock, LOCK_SECONDS))) return false;
      try {
        // Read again under the lock: another reply may have just folded these in.
        const current = await this.toFold(chatbot.id, conversationId);
        if (!current) return false;
        const prompts = await this.ai
          .getPromptOverrides(['ally_ai_conversation_summary'])
          .catch(() => undefined);
        const result = await this.ai.summarizeConversation({
          summary: current.summary,
          messages: current.rows.map((r) => ({
            role: r.role,
            content: r.text,
          })),
          health: isHealthPack(chatbot.safetyPack),
          ...(prompts ? { prompts: prompts as Record<string, unknown> } : {}),
        });
        const text = result?.summary?.trim();
        if (!result || result.failed || !text) return false;
        const last = current.rows[current.rows.length - 1];
        await this.dataSource.query(
          `UPDATE chatbot_conversations
              SET summary = $2,
                  metadata = metadata || jsonb_build_object('summaryUpto', $3::text),
                  "updatedAt" = now()
            WHERE id = $1`,
          [conversationId, text.slice(0, 2000), last.id],
        );
        return true;
      } finally {
        await this.redis.releaseLock(lock).catch(() => undefined);
      }
    } catch (error) {
      this.logger.warn(
        `Conversation summary not updated for chatbot ${chatbot.id}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
      return false;
    }
  }

  /**
   * The messages that have left the run's window and aren't in the summary yet, oldest first, with
   * the summary so far. Null when there are none: the chat has 10 messages or fewer, or nothing
   * new has left the window since the last summary.
   */
  async toFold(
    chatbotId: string,
    conversationId: string,
  ): Promise<{ summary: string | null; rows: Row[] } | null> {
    const [conv] = (await this.dataSource.query(
      `SELECT summary, metadata->>'summaryUpto' AS upto
         FROM chatbot_conversations WHERE id = $1 AND chatbot_id = $2`,
      [conversationId, chatbotId],
    )) as { summary: string | null; upto: string | null }[];
    if (!conv) return null;
    // Everything before the newest 10 messages: the window a run reads.
    const rows = (await this.dataSource.query(
      `SELECT id, role, text, "createdAt" FROM (
         SELECT id, role, text, "createdAt",
                row_number() OVER (ORDER BY "createdAt" DESC, id DESC) AS from_end
           FROM chatbot_messages WHERE conversation_id = $1
       ) m
        WHERE from_end > $2
          AND ($3::uuid IS NULL OR ("createdAt", id) > (
                SELECT "createdAt", id FROM chatbot_messages WHERE id = $3::uuid))
        ORDER BY "createdAt" ASC, id ASC
        LIMIT $4`,
      [conversationId, MAX_HISTORY_MESSAGES, conv.upto, MAX_FOLD],
    )) as { id: string; role: string; text: string; createdAt: Date }[];
    const usable = rows
      .map((r) => ({
        id: r.id,
        role: (r.role === 'user' ? 'user' : 'assistant') as Row['role'],
        text: r.text ?? '',
        createdAt: new Date(r.createdAt),
      }))
      .filter((r) => r.text.trim() && r.text !== ERASED);
    if (!rows.length) return null;
    // All blank (erased): move the mark past them without a model call.
    if (!usable.length) {
      await this.dataSource.query(
        `UPDATE chatbot_conversations
            SET metadata = metadata || jsonb_build_object('summaryUpto', $2::text)
          WHERE id = $1`,
        [conversationId, rows[rows.length - 1].id],
      );
      return null;
    }
    return { summary: conv.summary, rows: usable };
  }
}
